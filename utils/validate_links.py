import os
import sys
import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse, urljoin

# Configuration
BASE_DIR = sys.argv[1]  # ⬅️ Update this
LOCAL_SERVER_BASE_URL = "http://danbotlab.local/"  # ⬅️ Update if needed
TIMEOUT = 5  # seconds

def find_html_files(base_dir):
    html_files = []
    for root, _, files in os.walk(base_dir):
        for file in files:
            if file.endswith(".html"):
                html_files.append(os.path.join(root, file))
    return html_files

def extract_hrefs(file_path):
    with open(file_path, "r", encoding="utf-8") as f:
        soup = BeautifulSoup(f, "html.parser")
    return [a.get("href") for a in soup.find_all("a", href=True)]

def validate_href(html_file_path, href):
    parsed = urlparse(href)

    # Absolute external links
    if parsed.scheme in ["http", "https"]:
        try:
            response = requests.head(href, allow_redirects=True, timeout=TIMEOUT)
            return (response.status_code, "external")
        except requests.RequestException:
            return (None, "external")

    # Relative links → route via local dev server
    elif not parsed.scheme:
        # Compute path relative to project root, then map to localhost
        html_dir = os.path.dirname(os.path.relpath(html_file_path, BASE_DIR))
        relative_path = os.path.normpath(os.path.join(html_dir, parsed.path))
        url = urljoin(LOCAL_SERVER_BASE_URL, relative_path.replace(os.sep, "/"))

        try:
            response = requests.head(url, allow_redirects=True, timeout=TIMEOUT)
            return (response.status_code, "local")
        except requests.RequestException:
            return (None, "local")

    # Skip unsupported schemes (mailto, javascript, etc.)
    return (None, "skipped")

def main():
    html_files = find_html_files(BASE_DIR)
    broken_links = []

    for html_file in html_files:
        print(f"Checking {html_file}")
        hrefs = extract_hrefs(html_file)
        for href in hrefs:
            code, link_type = validate_href(html_file, href)
            if code is None or code >= 400:
                broken_links.append((html_file, href, code, link_type))

    print("\n🔍 Broken Links Report:")
    for file, link, code, link_type in broken_links:
        print(f"[{code or 'ERR'}] {link_type.upper()} link '{link}' in file: {file}")

if __name__ == "__main__":
    main()
