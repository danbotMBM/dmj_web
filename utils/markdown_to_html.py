import pycmarkgfm
import os
import sys
from pathlib import Path
from pycmarkgfm import options

def find_md_files(start_path):
    md_files = []
    for root, dirs, files in os.walk(start_path):
        for file in files:
            if file.endswith('.md') and file.lower() != 'readme.md':
                md_files.append(os.path.join(root, file))
    return md_files

def convert_md_to_html(path):
    s = p.split("/")
    file_name = "".join(s[-1].split(".")[0:-1])
    path = ""
    if len(s) > 1:
        path = "/".join(s[:-1]) + "/"
    md = open(p, "r").read()
    html = pycmarkgfm.markdown_to_html(md, options=options.unsafe)
    open(path + file_name + "_md.html", "w").write(html)


path = sys.argv[1]
paths = find_md_files(path)
print(paths)
for p in paths:
    convert_md_to_html(paths)