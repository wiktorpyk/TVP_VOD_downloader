#!/usr/bin/env python3
import os
import json
import time
import threading
import subprocess
import shutil
import urllib.request
import argparse
import glob


def check_dependencies():
    missing = []
    for tool, install in [
        ('tt',     "pip install --pre ttconv"),
        ('yt-dlp', "pip install yt-dlp"),
        ('ffmpeg', "your system package manager"),
    ]:
        if not shutil.which(tool):
            missing.append(f"  '{tool}' — install with: {install}")

    if missing:
        raise RuntimeError("Missing required dependencies:\n" + "\n".join(missing))


def get_default_temp_dir():
    temp_dir = os.path.expanduser('~/tmp')
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


def convert_ttml_to_vtt(input_filepath, output_filepath):
    cmd = [
        shutil.which('tt'), 'convert',
        '-i', input_filepath,
        '-o', output_filepath,
        '--itype', 'TTML',
        '--otype', 'VTT',
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ttconv conversion failed:\n{proc.stderr.decode('utf-8', errors='ignore')}"
        )
    print(f"Converted subtitles saved to: {output_filepath}")


def validate_json_data(json_data):
    for field in ('manifest_url', 'subtitles_url'):
        if field not in json_data:
            raise KeyError(f"Missing required field: '{field}'")
        if not json_data[field].startswith('http'):
            raise ValueError(f"Invalid {field}: must start with http/https")


def load_json_data(json_file_path):
    try:
        with open(json_file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Error: JSON file not found: {json_file_path}")
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {json_file_path}: {e}")
    return None


def build_metadata_flags(metadata):
    """Return a flat list of ffmpeg -metadata key=value arguments."""
    flags = []
    for key, value in metadata.items():
        if value:
            flags += ['-metadata', f'{key}={value}']
    return flags


def background_task(manifest_url, subtitle_url, season_episode, tmp_dir, video_name, language_code, metadata):
    file_name = f"{video_name}_{season_episode}" if season_episode else video_name
    mp4_path   = os.path.join(tmp_dir, f"{file_name}.mp4")
    ttml_path  = os.path.join(tmp_dir, f"{file_name}.xml")
    vtt_path   = os.path.join(tmp_dir, f"{file_name}.vtt")
    final_path = os.path.join(os.getcwd(), f"{file_name}.mp4")

    print(f"[{season_episode}] Starting download…")

    subprocess.run([
        'yt-dlp', manifest_url,
        '--force-generic-extractor',
        '--merge-output-format', 'mp4',
        '-o', mp4_path,
        '--fragment-retries', 'infinite',
    ])

    vtt_ready = False
    try:
        urllib.request.urlretrieve(subtitle_url, ttml_path)
        print(f"Subtitle downloaded to: {ttml_path}")
        convert_ttml_to_vtt(ttml_path, vtt_path)
        vtt_ready = os.path.exists(vtt_path)
    except Exception as e:
        print(f"[{season_episode}] Subtitle error: {e}")

    metadata_flags = build_metadata_flags(metadata)

    if vtt_ready:
        ffmpeg_cmd = [
            'ffmpeg', '-i', mp4_path, '-i', vtt_path,
            '-c', 'copy', '-c:s', 'mov_text',
            '-metadata:s:s:0', f'language={language_code}',
            *metadata_flags,
            final_path,
        ]
        label = "with subtitles"
    else:
        ffmpeg_cmd = [
            'ffmpeg', '-i', mp4_path,
            '-c', 'copy',
            *metadata_flags,
            final_path,
        ]
        label = "no subtitles"

    proc = subprocess.run(ffmpeg_cmd, capture_output=True)
    if proc.returncode == 0:
        print(f"[{season_episode}] Saved ({label}): {final_path}")
    else:
        print(f"[{season_episode}] FFmpeg error: {proc.stderr.decode('utf-8', errors='ignore')}")

    for path in (mp4_path, ttml_path, vtt_path):
        if path and os.path.exists(path):
            os.remove(path)

    print(f"[{season_episode}] Done.")


def process_episode(json_data, temp_dir, language_code):
    try:
        validate_json_data(json_data)
    except (KeyError, ValueError) as e:
        print(f"Error: Invalid episode data — {e}")
        return None

    season_episode = json_data.get('episode_code', '')
    video_name     = json_data.get('title', 'video')
    episode_title  = json_data.get('episode_title', 'Unknown')

    metadata = {
        'title':       episode_title,
        'show':        json_data.get('title', ''),
        'episode_id':  season_episode,
        'description': json_data.get('description', ''),
        'comment':     json_data.get('description', ''),
    }

    print(f"\n--- {episode_title} ({season_episode}) ---")

    thread = threading.Thread(
        target=background_task,
        args=(
            json_data['manifest_url'],
            json_data['subtitles_url'],
            season_episode,
            temp_dir,
            video_name,
            language_code,
            metadata,
        ),
        daemon=False,
    )
    thread.start()
    return thread


def main():
    parser = argparse.ArgumentParser(
        description='Download videos and subtitles from TVP VOD using JSON episode files.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s episode.json
  %(prog)s ./json_files/
  %(prog)s episode.json --language en
        """,
    )

    parser.add_argument(
        'json',
        metavar='JSON',
        help='Path to a JSON episode file or a directory containing JSON files.',
    )
    parser.add_argument(
        '-l', '--language',
        default='pl',
        metavar='CODE',
        help='Subtitle language code (default: pl).',
    )
    parser.add_argument(
        '--temp-dir',
        metavar='DIR',
        help='Temporary directory (default: ~/tmp).',
    )

    args = parser.parse_args()

    try:
        check_dependencies()
    except RuntimeError as e:
        print(f"Dependency error: {e}")
        return

    temp_dir = os.path.expanduser(args.temp_dir) if args.temp_dir else get_default_temp_dir()
    os.makedirs(temp_dir, exist_ok=True)
    os.environ['TMPDIR'] = temp_dir

    json_path = os.path.expanduser(args.json)

    if os.path.isfile(json_path):
        json_files = [json_path]
    elif os.path.isdir(json_path):
        json_files = sorted(glob.glob(os.path.join(json_path, '*.json')))
        if not json_files:
            print(f"No JSON files found in: {json_path}")
            return
    else:
        print(f"Error: '{json_path}' is not a valid file or directory.")
        return

    print(f"Found {len(json_files)} JSON file(s) to process.")

    threads = []
    queued  = 0

    for json_file in json_files:
        print(f"\nLoading: {json_file}")
        data = load_json_data(json_file)
        if data:
            thread = process_episode(data, temp_dir, args.language)
            if thread:
                threads.append(thread)
                queued += 1
                time.sleep(2)

    print(f"\n{queued}/{len(json_files)} episode(s) queued. Waiting for downloads to finish…")

    for thread in threads:
        thread.join()

    print("All downloads completed.")

    try:
        shutil.rmtree(temp_dir)
        print(f"Cleaned up temporary directory: {temp_dir}")
    except Exception as e:
        print(f"Warning: Could not remove temp directory: {e}")


if __name__ == "__main__":
    main()