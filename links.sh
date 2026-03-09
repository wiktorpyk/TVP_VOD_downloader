#!/bin/bash

# File containing the list of links
LINKS_FILE="links.txt"

# Directory where files are downloaded
DOWNLOAD_DIR="$HOME/Downloads"

# Function to wait for a new file in Downloads
wait_for_download() {
    local before_files=("$@")
    local new_file=""
    
    echo "Waiting for a new file to appear in $DOWNLOAD_DIR..." >&2
    
    while true; do
        # List current files
        current_files=("$DOWNLOAD_DIR"/*)
        
        # Compare with previous snapshot
        for f in "${current_files[@]}"; do
            if [[ ! " ${before_files[@]} " =~ " ${f} " ]]; then
                new_file="$f"
                break 2
            fi
        done
        
        sleep 1
    done

    echo "Detected new file: $new_file" >&2
    echo "$new_file"
}

mkdir -p videos

# Read links one by one
while IFS= read -r link; do
    echo "Opening link: $link"
    
    # Take a snapshot of current files in Downloads
    existing_files=("$DOWNLOAD_DIR"/*)
    
    # Open link in default browser
    nohup xdg-open "$link" >/dev/null 2>&1 &
    
    # Wait for a new file to appear
    downloaded_file=$(wait_for_download "${existing_files[@]}")
    
    # Call Python parser
    echo "Parsing file with Python script..."
    if ! python3 downloader.py "$downloaded_file" videos/ --keep-temp --check-dropped-frames; then
        echo "Error: Python script failed while processing $downloaded_file"
        exit 1
    fi
    
    echo "Finished processing $downloaded_file"
    echo "-----------------------------------"
done < "$LINKS_FILE"

echo "All links processed."