#!/usr/bin/env python3

import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import re


def check_dependencies():
    missing = []
    for tool, install in [
        ('tt', "pip install --pre ttconv"),
        ('yt-dlp', "pip install yt-dlp"),
        ('ffmpeg', "your system package manager"),
        ('ffprobe', "your system package manager"),
    ]:
        if not shutil.which(tool):
            missing.append(
                f"  '{tool}' — install with: {install}"
            )

    if missing:
        raise RuntimeError(
            "Missing required dependencies:\n" + "\n".join(missing)
        )


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
            f"ttconv conversion failed:\n"
            f"{proc.stderr.decode('utf-8', errors='ignore')}"
        )
    print(f"Converted subtitles saved to: {output_filepath}")


def check_file_exists(filepath):
    """Check if a file exists and is readable."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")
    if not os.path.isfile(filepath):
        raise ValueError(f"Path is not a file: {filepath}")
    if not os.access(filepath, os.R_OK):
        raise PermissionError(f"File not readable: {filepath}")
    return True


def validate_json_data(json_data):
    for field in ('manifest_url', 'subtitles_url'):
        if field not in json_data:
            raise KeyError(f"Missing required field: '{field}'")
        if not json_data[field].startswith('http'):
            raise ValueError(
                f"Invalid {field}: must start with http/https"
            )


def load_json_data(json_file_path):
    try:
        check_file_exists(json_file_path)
        with open(json_file_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, ValueError, PermissionError, json.JSONDecodeError) as e:
        if isinstance(e, json.JSONDecodeError):
            error_msg = f"Error: Invalid JSON in {json_file_path}: {e}"
        else:
            error_msg = f"Error: {e}"
        print(error_msg, file=sys.stderr)
        sys.exit(1)


def verify_mp4(filepath, episode_code, has_subtitles_expected):
    """
    Verify the muxed MP4 before it is moved to the final destination.

    Checks performed:
      1. File exists and is non-empty.
      2. Duration is non-zero (ffprobe).
      3. Subtitle track present when expected (ffprobe).
      4. No decode errors or dropped frames (ffmpeg null-sink pass).

    Returns:
        bool: True if all hard checks pass, False otherwise.
        Subtitle absence is reported as a warning but does not fail the check.
    """
    if not os.path.exists(filepath) or os.path.getsize(filepath) == 0:
        _tagged_print(episode_code, "Verification FAILED: file missing or empty.")
        return False

    # --- ffprobe: duration + stream inventory ---
    probe_cmd = [
        'ffprobe', '-v', 'error',
        '-show_entries', 'format=duration:stream=codec_type',
        '-of', 'json',
        filepath,
    ]
    probe = subprocess.run(
        probe_cmd, capture_output=True, text=True, stdin=subprocess.DEVNULL
    )
    if probe.returncode != 0:
        _tagged_print(
            episode_code,
            f"Verification FAILED: ffprobe error — {probe.stderr.strip()}"
        )
        return False

    try:
        info = json.loads(probe.stdout)
    except json.JSONDecodeError:
        _tagged_print(episode_code, "Verification FAILED: could not parse ffprobe output.")
        return False

    duration = float(info.get('format', {}).get('duration', 0))
    if duration <= 0:
        _tagged_print(episode_code, "Verification FAILED: zero or missing duration.")
        return False

    if has_subtitles_expected:
        streams = info.get('streams', [])
        if not any(s.get('codec_type') == 'subtitle' for s in streams):
            _tagged_print(
                episode_code,
                "Verification WARNING: subtitle track missing from output."
            )

    # --- ffmpeg null-sink: detect dropped / corrupt frames (sample only) ---
    # Decode the first and last 30 s rather than the full file to avoid
    # hanging for minutes on long episodes while still catching corruption.
    SAMPLE_S = 30
    tail_start = max(0.0, duration - SAMPLE_S)
    _tagged_print(
        episode_code,
        f"Verification: decode-checking first/last {SAMPLE_S}s…"
    )
    errors = []
    for seek, label in [(0, 'head'), (tail_start, 'tail')]:
        decode_cmd = [
            'ffmpeg', '-v', 'error',
            '-ss', str(seek), '-i', filepath,
            '-t', str(SAMPLE_S),
            '-f', 'null', '/dev/null',
        ]
        decode = subprocess.run(
            decode_cmd, capture_output=True, text=True,
            stdin=subprocess.DEVNULL, timeout=120
        )
        if decode.returncode != 0:
            _tagged_print(
                episode_code,
                f"Verification FAILED: ffmpeg decode error ({label}) — "
                f"{decode.stderr.strip()[:400]}"
            )
            return False
        if decode.stderr.strip():
            errors.append(f"{label}: {decode.stderr.strip()[:200]}")

    if errors:
        _tagged_print(
            episode_code,
            "Verification WARNING: " + " | ".join(errors)
        )

    _tagged_print(
        episode_code, f"Verification passed — duration {duration:.1f}s."
    )
    return True


MAX_CONCURRENT_DOWNLOADS = 3
_download_semaphore = threading.Semaphore(MAX_CONCURRENT_DOWNLOADS)
_stop_event = threading.Event()

# Lines from yt-dlp that add no value when running multiple parallel downloads
_YTDLP_NOISE_PREFIXES = (
    '[generic]',
    '[info]',
    '[ism]',
    'WARNING:',
)


class ProgressDisplay:
    """
    Thread-safe multi-line progress display.

    Each registered episode occupies one persistent line that is updated
    in-place.  All other messages are inserted *above* the progress block
    so they scroll normally.

    On every update the entire progress block is redrawn from scratch,
    which avoids cursor-position drift when many threads write concurrently.

    Falls back to plain printing when stdout is not a tty (e.g. piped to
    a file).
    """

    _HIDE = "\x1b[?25l"
    _SHOW = "\x1b[?25h"
    _CLEAR_LINE = "\r\x1b[2K"
    _UP = "\x1b[{}A"

    def __init__(self):
        """Initialize the progress display with thread-safe components."""
        self._lock = threading.Lock()
        self._slots = {}  # episode_code -> row index (0-based, top = 0)
        self._lines = []  # current text for each row
        self._last_update = {}  # episode_code -> last redraw timestamp
        self._tty = sys.stdout.isatty()
        if self._tty:
            sys.stdout.write(self._HIDE)
            sys.stdout.flush()

    def _nrows(self):
        return len(self._lines)

    def _redraw_block(self):
        """
        Redraw every progress line in-place.
        Must be called with self._lock held and only when self._tty is True.
        Assumes the cursor is already positioned one line below the last
        progress line (i.e. the normal 'rest' position).
        """
        n = self._nrows()
        if n == 0:
            return
        sys.stdout.write(self._UP.format(n))
        for line in self._lines:
            sys.stdout.write(self._CLEAR_LINE + line + "\n")
        sys.stdout.flush()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def register(self, episode_code, initial_text=""):
        """Add a new progress row for *episode_code* at the bottom."""
        line = f"[{episode_code}] {initial_text}"
        with self._lock:
            self._slots[episode_code] = len(self._lines)
            self._lines.append(line)
            self._last_update[episode_code] = 0.0
            sys.stdout.write(self._CLEAR_LINE + line + "\n")
            sys.stdout.flush()

    def update(self, episode_code, text):
        """Overwrite the progress line for *episode_code* in-place."""
        now = time.monotonic()
        with self._lock:
            if episode_code not in self._slots:
                return
            idx = self._slots[episode_code]
            self._lines[idx] = f"[{episode_code}] {text}"

            if not self._tty:
                # In non-tty mode lines can't be overwritten, so suppress
                # high-frequency progress updates to avoid log spam.
                return

            # Throttle redraws to at most once per second per episode.
            if now - self._last_update.get(episode_code, 0.0) < 1.0:
                return
            self._last_update[episode_code] = now

            self._redraw_block()

    def message(self, text):
        """Print *text* as a normal scrolling line above the progress block."""
        with self._lock:
            n = self._nrows()
            if not self._tty or n == 0:
                sys.stdout.write(text + "\n")
                sys.stdout.flush()
                return
            # Move above the block, inject the message, then redraw the block.
            sys.stdout.write(self._UP.format(n))
            sys.stdout.write(self._CLEAR_LINE + text + "\n")
            for line in self._lines:
                sys.stdout.write(self._CLEAR_LINE + line + "\n")
            sys.stdout.flush()

    def close(self):
        """Restore cursor visibility."""
        if self._tty:
            sys.stdout.write(self._SHOW)
            sys.stdout.flush()


_progress_display = ProgressDisplay()


def _tagged_print(episode_code, text):
    _progress_display.message(f"[{episode_code}] {text}")


def _is_progress_line(line):
    """Return True for yt-dlp [download] lines that carry ETA info (i.e. in-progress fragments)."""
    return line.startswith('[download]') and 'ETA' in line


def _run_yt_dlp(args, episode_code):
    """Run yt-dlp, routing progress lines to the live display and the rest as messages."""
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    for line in proc.stdout:
        if _stop_event.is_set():
            proc.terminate()
            break
        line = line.rstrip()
        if not line:
            continue
        if any(line.startswith(p) for p in _YTDLP_NOISE_PREFIXES):
            continue
        if _is_progress_line(line):
            progress_text = line[len('[download]'):].strip()
            _progress_display.update(episode_code, progress_text)
        else:
            _tagged_print(episode_code, line)
    proc.wait()


def download_episode(
    manifest_url, subtitle_url, temp_dir, metadata,
    output_directory, keep_temp=False
):
    episode_code = metadata.get("episode_id", "")
    show_title = metadata.get("show", "")
    language_code = metadata.get("language", "pl")
    _progress_display.register(episode_code, "Waiting for slot…")
    _download_semaphore.acquire()
    try:
        output_stem = f"{show_title}_{episode_code}" if episode_code else show_title
        mp4_path = os.path.join(temp_dir, f"{output_stem}.mp4")
        ttml_path = os.path.join(temp_dir, f"{output_stem}.xml")
        vtt_path = os.path.join(temp_dir, f"{output_stem}.vtt")
        muxed_path = os.path.join(temp_dir, f"{output_stem}_muxed.mp4")
        final_path = os.path.join(output_directory, f"{output_stem}.mp4")

        if os.path.exists(final_path):
            _tagged_print(
                episode_code,
                f"Skipping — output file already exists: {final_path}"
            )
            _progress_display.update(episode_code, "Skipped (already exists).")
            return

        _progress_display.update(episode_code, "Starting download…")

        _run_yt_dlp([
            'yt-dlp', manifest_url,
            '--merge-output-format', 'mp4',
            '-o', mp4_path,
            '--fragment-retries', 'infinite',
            '--newline',
        ], episode_code)
        _progress_display.update(episode_code, "Download complete.")

        time.sleep(1)  # brief pause to ensure file is fully flushed to disk

        has_subtitles = False
        max_retries = 10
        for attempt in range(max_retries):
            try:
                urllib.request.urlretrieve(subtitle_url, ttml_path)
                _tagged_print(episode_code, f"Subtitles downloaded → {ttml_path}")
                convert_ttml_to_vtt(ttml_path, vtt_path)
                has_subtitles = os.path.exists(vtt_path)
                break
            except Exception as e:
                if attempt < max_retries - 1:
                    _tagged_print(episode_code, f"Subtitle download attempt {attempt + 1}/{max_retries} failed: {e}")
                    time.sleep(2 ** attempt)  # Exponential backoff
                else:
                    _tagged_print(episode_code, f"Subtitle download failed after {max_retries} attempts: {e}")

        metadata_flags = []
        for key, value in metadata.items():
            if value is not None:
                flag = "-metadata"
                flag += f" {key}={value}"
                metadata_flags.append(flag)

        if has_subtitles:
            ffmpeg_cmd = [
                'ffmpeg', '-y', '-nostdin', '-i', mp4_path, '-i', vtt_path,
                '-c', 'copy', '-c:s', 'mov_text',
                '-metadata:s:s:0', f'language={language_code}',
                *metadata_flags,
                muxed_path,
            ]
            subtitle_status = "with subtitles"
        else:
            ffmpeg_cmd = [
                'ffmpeg', '-y', '-nostdin', '-i', mp4_path,
                '-c', 'copy',
                *metadata_flags,
                muxed_path,
            ]
            subtitle_status = "no subtitles"

        _tagged_print(episode_code, "Muxing…")
        proc = subprocess.run(ffmpeg_cmd, capture_output=True)
        if proc.returncode != 0:
            _tagged_print(
                episode_code,
                f"FFmpeg error: {proc.stderr.decode('utf-8', errors='ignore')}"
            )
        else:
            _tagged_print(
                episode_code, f"Muxing complete ({subtitle_status}). Verifying…"
            )
            if verify_mp4(muxed_path, episode_code, has_subtitles_expected=has_subtitles):
                shutil.move(muxed_path, final_path)
                _tagged_print(episode_code, f"Saved: {final_path}")
            else:
                _tagged_print(
                    episode_code,
                    f"Verification failed — file kept for inspection: {muxed_path}"
                )
                muxed_path = None  # don't delete it below

        if not keep_temp:
            for path in (mp4_path, ttml_path, vtt_path, muxed_path):
                if path and os.path.exists(path):
                    os.remove(path)
        else:
            _tagged_print(episode_code, "Temp files kept (--keep-temp).")

        _tagged_print(episode_code, "Done.")
    finally:
        _download_semaphore.release()


def parse_json_ld_data(json_data, language_code="pl"):
    """
    Extract episode metadata from JSON-LD data.

    Returns a single dict with ffmpeg-ready metadata keys plus
    'manifest_url' and 'subtitles_url'.
    """

    ld = json_data.get("JSON-LD", {}) or {}

    webpage = (
        ld.get("mainEntityOfPage", {}) or {}
    ).get("@id")

    episode_id = None
    season_number = None
    episode_sort = None

    if webpage:
        try:
            episode_id = webpage.split("/")[-1].split(",")[1]
        except (IndexError, AttributeError):
            pass

    if episode_id:
        match = re.match(r"S(\d+)E(\d+)", episode_id)
        if match:
            season_number = int(match.group(1))
            episode_sort = int(match.group(2))

    name = ld.get("name", "")

    show = None
    title = None

    if " – " in name:
        left, title = name.split(" – ", 1)
    else:
        left = name

    if " odc." in left:
        show = left.split(" odc.")[0]
    else:
        show = left

    network = (
        ld.get("publisher", {}) or {}
    ).get("legalName")

    return {
        "manifest_url": json_data.get("manifest_url"),
        "subtitles_url": json_data.get("subtitles_url"),
        "metadata": {
            "title": title,
            "show": show,
            "episode_id": episode_id,
            "description": ld.get("description"),
            "purl": webpage,
            "date": ld.get("datePublished"),
            "network": network,
            "language": language_code,
            "season_number": season_number,
            "episode_sort": episode_sort,
        },
    }


def process_episode(json_data, temp_dir, language_code, output_directory, keep_temp=False):
    """Process a single episode by validating data and starting download thread."""
    try:
        validate_json_data(json_data)
    except (KeyError, ValueError) as e:
        print(f"Error: Invalid episode data — {e}", file=sys.stderr)
        sys.exit(1)

    parsed = parse_json_ld_data(json_data, language_code)

    metadata = parsed.get("metadata", {})
    episode_code = metadata.get("episode_id") or ""
    episode_title = metadata.get("title") or episode_code

    _progress_display.message(f"--- {episode_title} ({episode_code}) ---")

    thread = threading.Thread(
        target=download_episode,
        args=(
            parsed["manifest_url"],
            parsed["subtitles_url"],
            temp_dir,
            parsed["metadata"],
            output_directory,
            keep_temp,
        ),
        daemon=False,
    )
    thread.start()
    return thread


def main():
    """Main entry point for the TVP VOD downloader."""
    parser = argparse.ArgumentParser(
        description='Download videos and subtitles from TVP VOD using JSON episode files.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s episode.json
  %(prog)s episode.json ~/Videos/
  %(prog)s ./json_files/ ~/Videos/
  %(prog)s episode.json ~/Videos/ --language en
        """,
    )

    parser.add_argument(
        'input_path',
        metavar='INPUT',
        help='Path to a JSON episode file or a directory containing JSON files.',
    )
    parser.add_argument(
        'output_directory',
        metavar='OUTPUT_DIR',
        nargs='?',
        default=None,
        help='Directory to save downloaded videos (default: current directory).',
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
    parser.add_argument(
        '--keep-temp',
        action='store_true',
        default=False,
        help='Do not delete temporary files after download.',
    )

    try:
        args = parser.parse_args()
    except SystemExit:
        # argparse already printed the error and exits with code 2
        sys.exit(2)

    if args.keep_temp:
        print("Keep temporary files enabled (--keep-temp)")

    try:
        check_dependencies()
    except RuntimeError as e:
        print(f"Dependency error: {e}", file=sys.stderr)
        sys.exit(1)

    temp_dir = (
        os.path.expanduser(args.temp_dir)
        if args.temp_dir else get_default_temp_dir()
    )
    os.makedirs(temp_dir, exist_ok=True)
    os.environ['TMPDIR'] = temp_dir

    output_directory = (
        os.path.expanduser(args.output_directory)
        if args.output_directory else os.getcwd()
    )
    os.makedirs(output_directory, exist_ok=True)

    json_path = os.path.expanduser(args.input_path)

    try:
        if os.path.isfile(json_path):
            json_files = [json_path]
        elif os.path.isdir(json_path):
            json_files = sorted(glob.glob(os.path.join(json_path, '*.json')))
            if not json_files:
                print(f"No JSON files found in: {json_path}", file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Error: '{json_path}' is not a valid file or directory.", file=sys.stderr)
            sys.exit(1)
    except Exception as e:
        print(f"Error accessing path '{json_path}': {e}", file=sys.stderr)
        sys.exit(1)

    print(f"Found {len(json_files)} JSON file(s) to process.")

    threads = []
    queued = 0

    try:
        for json_file in json_files:
            _progress_display.message(f"Loading: {json_file}")
            json_data = load_json_data(json_file)
            if json_data:
                thread = process_episode(json_data, temp_dir, args.language, output_directory, args.keep_temp)
                if thread:
                    threads.append(thread)
                    queued += 1
                    time.sleep(2)

        _progress_display.message(
            f"{queued}/{len(json_files)} episode(s) queued. "
            "Waiting for downloads to finish…"
        )

        try:
            for thread in threads:
                while thread.is_alive():
                    thread.join(timeout=1)
        except KeyboardInterrupt:
            print("\nInterrupted — signalling threads to stop…", file=sys.stderr)
            _stop_event.set()
            for thread in threads:
                thread.join()
            print("All threads stopped.", file=sys.stderr)
            sys.exit(1)
        else:
            print("All downloads completed.")
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        _progress_display.close()

    if args.keep_temp:
        print(f"Temporary files kept in: {temp_dir}")
    else:
        try:
            shutil.rmtree(temp_dir)
            print(f"Cleaned up temporary directory: {temp_dir}")
        except Exception as e:
            print(f"Warning: Could not remove temp directory: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
