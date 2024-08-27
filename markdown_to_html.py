import pycmarkgfm
import sys
from pycmarkgfm import options
paths = sys.argv[1:]
print(paths)
for p in paths:
    s = p.split("/")
    file_name = "".join(s[-1].split(".")[0:-1])
    path = ""
    if len(s) > 1:
        path = "/".join(s[:-1]) + "/"
    print(file_name, path)
    md = open(p, "r").read()
    html = pycmarkgfm.markdown_to_html(md, options=options.unsafe)
    open(path + file_name + "_md.html", "w").write(html)