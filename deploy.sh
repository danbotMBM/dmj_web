#!/bin/bash
set -e

SRC_DIR="/home/danbot/dev/dmj_web"
DEST_DIR="/opt/dmj_web"
DEV_MODE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--dev)
            DEV_MODE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [-d|--dev]"
            exit 1
            ;;
    esac
done

if [ "$DEV_MODE" = true ]; then
    echo "=== DMJ Web Dev Mode ==="

    # Build the Strava cronjob
    echo "Building strava cronjob..."
    cd "$SRC_DIR/backend/cronjobs"
    go build -o strava strava_runs.go
    
    ./strava

    # Build the Go backend
    echo "Building backend..."
    cd "$SRC_DIR/backend"
    go build -o server

    # Run backend in foreground on port 8901
    echo "Starting backend on port 8901 (foreground)..."
    PORT=8901 CORS_ORIGIN="https://danbotlab" ./server
else
    echo "=== DMJ Web Production Deploy ==="

    # Build the Go backend
    echo "Building backend..."
    cd "$SRC_DIR/backend"
    go build -o server

    # Update utils.js API_BASE for production
    echo "Setting production API URL..."
    sed -i "s|const API_BASE = '.*';|const API_BASE = 'https://api.danielmarkjones.com';|" "$SRC_DIR/utils.js"

    # Create destination directory
    echo "Creating $DEST_DIR..."
    sudo mkdir -p "$DEST_DIR/backend"

    # Build the Strava cronjob
    echo "Building strava cronjob..."
    cd "$SRC_DIR/backend/cronjobs"
    go build -o strava strava_runs.go

    # Copy web files (excluding dev/git stuff)
    echo "Copying web files..."
    sudo rsync -av --delete \
        --exclude='.git' \
        --exclude='.gitignore' \
        --exclude='.claude' \
        --exclude='deploy.sh' \
        --exclude='README.md' \
        --exclude='backend/cronjobs/strava_runs.json' \
        --exclude='backend/running.json' \
        --exclude='backend/trivia_analytics.db' \
        --exclude='backend/trivia_analytics.db-wal' \
        --exclude='backend/trivia_analytics.db-shm' \
        "$SRC_DIR/" "$DEST_DIR/"

    # Restore dev API URL in source
    echo "Restoring dev API URL in source..."
    sed -i "s|const API_BASE = '.*';|const API_BASE = 'https://api.danbotlab';|" "$SRC_DIR/utils.js"

    # Copy backend binary
    echo "Copying backend binary..."
    sudo cp "$SRC_DIR/backend/server" "$DEST_DIR/backend/"

    # Set ownership
    sudo chown -R danbot:danbot "$DEST_DIR"
    sudo chmod -R 770 "$DEST_DIR/backend"

    # Install systemd service
    echo "Installing systemd service..."
    sudo cp "$SRC_DIR/backend/dmj-backend.service" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable dmj-backend

    # Restart the service
    echo "Restarting service..."
    sudo systemctl restart dmj-backend

    echo "=== Deploy complete ==="
    sudo systemctl status dmj-backend --no-pager

    # Install strava cron job (runs every hour, persists across restarts)
    echo "Installing strava cron job..."
    STRAVA_CRON="0 * * * * cd $DEST_DIR/backend/cronjobs && ./strava >> /opt/dmj_web/backend/cronjobs/strava_logs.log 2>&1"
    ( crontab -l 2>/dev/null | grep -v "$DEST_DIR/backend/cronjobs.*strava"; echo "$STRAVA_CRON" ) | crontab -

    echo "=== Deploy complete ==="
    sudo systemctl status dmj-backend --no-pager
    echo ""
    echo "Strava cron job:"
    crontab -l | grep strava
fi
