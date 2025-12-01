#!/usr/bin/env python3
import os
import re
import time
import threading
import subprocess
import shutil
import urllib.request
import argparse
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options


def get_default_temp_dir():
    temp_dir = os.path.expanduser('~/tmp')
    os.makedirs(temp_dir, exist_ok=True)
    return temp_dir


def convert_ttml_to_vtt(input_filepath, output_filepath, target_language_code=None):
    """
    Convert a TTML (.xml) file to WebVTT (.vtt) using the `ttconv` CLI.
    """
    tt_exe = shutil.which('tt')
    if not tt_exe:
        raise RuntimeError("ttconv CLI 'tt' not found. Install with 'pip install --pre ttconv'.")

    cmd = [
        tt_exe, 'convert', 
        '-i', input_filepath, 
        '-o', output_filepath, 
        '--itype', 'TTML', 
        '--otype', 'VTT'
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        stderr = proc.stderr.decode('utf-8', errors='ignore')
        print('ttconv error output:\n', stderr)
        raise RuntimeError('ttconv conversion failed')
    print(f"Converted subtitles saved to: {output_filepath}")


def return_start_website(driver):
    """Return to the starting website."""
    driver.get(start_url)


def background_task(manifest_url, subtitle_url, season_episode, tmp_dir, video_name, language_code):
    """Background task to download video and subtitles."""
    file_name = f"{video_name}_{season_episode}" if season_episode else video_name
    mp4_path = os.path.join(tmp_dir, f"{file_name}.mp4")
    ttml_path = os.path.join(tmp_dir, f"{file_name}.xml")
    vtt_path = os.path.join(tmp_dir, f"{file_name}.vtt")
    final_mp4_path = os.path.join(os.getcwd(), f"{file_name}.mp4")

    print(f"Background start: {season_episode}")
    # Start yt-dlp in a subprocess
    ytdlp_proc = subprocess.Popen(
        ['yt-dlp', 
            manifest_url, 
            '--merge-output-format', 'mp4', 
            '-o', mp4_path,
            '--fragment-retries', 'infinite'
        ]
    )

    # Wait for yt-dlp to finish
    ytdlp_proc.wait()

    # Download subtitle
    try:
        urllib.request.urlretrieve(subtitle_url, ttml_path)
        print(f"Subtitle saved to: {ttml_path}")
        
        # Convert subtitles to VTT
        convert_ttml_to_vtt(ttml_path, vtt_path, language_code)
    except Exception as e:
        print(f"Subtitle download/conversion failed: {e}")
        vtt_path = None

    # Merge subtitles into mp4 if available
    if vtt_path and os.path.exists(vtt_path):
        ffmpeg_cmd = [
            'ffmpeg', '-i', mp4_path, '-i', vtt_path,
            '-c', 'copy', '-c:s', 'mov_text',
            '-metadata:s:s:0', f'language={language_code}',
            final_mp4_path
        ]
        print(f"Merging subtitles into video: {final_mp4_path}")
        ffmpeg_proc = subprocess.run(ffmpeg_cmd, capture_output=True)
        
        if ffmpeg_proc.returncode == 0:
            print(f"Final video with subtitles saved to: {final_mp4_path}")
        else:
            print(f"FFmpeg failed: {ffmpeg_proc.stderr.decode('utf-8', errors='ignore')}")
    else:
        # Move downloaded file if no subtitles
        try:
            os.replace(mp4_path, final_mp4_path)
            print(f"Final video (no subtitles) saved to: {final_mp4_path}")
        except Exception as e:
            print(f"Failed to move final video: {e}")

    # Clean up temporary files
    for temp_file in [mp4_path, ttml_path, vtt_path]:
        if os.path.exists(temp_file):
            os.remove(temp_file)

    print(f"Background finished: {season_episode}")


def main():
    """Main function to run the browser and capture media."""
    parser = argparse.ArgumentParser(
        description='Download videos and subtitles from TVP VOD platform',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s ranczo "https://vod.tvp.pl/seriale,18/ranczo-odcinki,316445/odcinek-1,S01E01,381046"
        """
    )
    
    parser.add_argument('video_name', help='Base name for output files (e.g., "ranczo")')
    parser.add_argument('start_url', help='Starting URL of the TVP VOD series')
    parser.add_argument('-l', '--language', default='pl', 
                       help='Subtitle language code (default: "pl")')
    parser.add_argument('--geckodriver', default='/snap/bin/geckodriver',
                       help='Path to geckodriver (default: /snap/bin/geckodriver)')
    parser.add_argument('--firefox-bin', default='/snap/firefox/current/usr/lib/firefox/firefox-bin',
                       help='Path to Firefox binary (default: /snap/firefox/current/usr/lib/firefox/firefox-bin)')
    parser.add_argument('--temp-dir', 
                       help='Temporary directory path (default: auto-detect best location)')
    
    args = parser.parse_args()
    
    # Determine and create temp directory
    if args.temp_dir:
        temp_dir = os.path.expanduser(args.temp_dir)
    else:
        temp_dir = get_default_temp_dir()
    
    os.makedirs(temp_dir, exist_ok=True)
    os.environ['TMPDIR'] = temp_dir

    global start_url
    start_url = args.start_url
    
    # Set up Firefox service and options
    service = Service(executable_path=args.geckodriver)
    
    firefox_options = Options()
    firefox_options.binary_location = args.firefox_bin
    firefox_options.add_argument('--no-sandbox')
    firefox_options.add_argument('--disable-dev-shm-usage')
    firefox_options.set_preference("devtools.netmonitor.har.enableAutoExportToFile", True)
    firefox_options.set_preference("devtools.netmonitor.har.defaultLogDir", temp_dir)

    # Pattern to match video.ism URLs
    pattern = re.compile(r'https://[^/]+/token/video/vod/.+/video\.ism[^\s]*')

    # Initialize the Firefox driver
    driver = webdriver.Firefox(service=service, options=firefox_options)
    
    try:
        return_start_website(driver)
        
        while True:
            # Get network resources
            resources = driver.execute_script("""
                var resources = window.performance.getEntriesByType('resource');
                return resources.map(function(r) { return r.name; });
            """)
            
            manifest_url = None
            subtitle_url = None
            
            for url in resources:
                url = url.strip()
                
                # Look for manifest URL
                if manifest_url is None and pattern.match(url):
                    manifest_url = re.sub(r'/video\.ism/.+', '/video.ism/Manifest', url)
                    print(f"\nFound manifest URL:\n{manifest_url}")
                    continue
                
                # Look for subtitle URL if we have a manifest
                if manifest_url and url.endswith('.xml') and 'repository/attachment' in url:
                    subtitle_url = url
                    
                    # Extract season/episode from URL
                    match = re.search(r'S(\d{2})E(\d{2})', driver.current_url)
                    season_episode = match.group(0) if match else None
                    
                    print(f"Found subtitle URL:\n{subtitle_url}")
                    print("\n--- Media Pair Captured ---")
                    print(f"Season/Episode: {season_episode}")
                    print(f"Manifest URL: {manifest_url}")
                    print(f"Subtitle URL: {subtitle_url}")
                    print("---------------------------")
                    print("\a")  # ASCII Bell character
                    
                    # Launch background thread for download
                    thread = threading.Thread(
                        target=background_task, 
                        args=(
                            manifest_url, 
                            subtitle_url, 
                            season_episode, 
                            temp_dir, 
                            args.video_name, 
                            args.language
                        ),
                        daemon=True
                    )
                    thread.start()
                    
                    # Reset and return to start
                    return_start_website(driver)
                    manifest_url = None
                    subtitle_url = None
                    break
            
            # Small delay to prevent excessive CPU usage
            time.sleep(1)
            
    except KeyboardInterrupt:
        driver.quit()
        shutil.rmtree(temp_dir)

if __name__ == "__main__":
    main()
