# dmj_web 
This is a place for my random web development stuff.

### tools used
* Nginx for web server
* Self hosted in my basement using Cloudflare proxy and dns
* Basic static client side html, css, and javascript
* Heavy usage of markdown with html conversion by [pycmarkgfm](https://github.com/Zopieux/pycmarkgfm) and css stolen from [github-markdown-css](https://github.com/sindresorhus/github-markdown-css?tab=readme-ov-file)
* For certificates I use LetsEncrypt

### the goal
Make a place for me to document and share projects in a fast and easy way.

# Setup

### Make sure that SELinux is set properly
```
sudo chcon -R -t httpd_sys_content_t <path/to/dir>
sudo semanage fcontext -a -t httpd_sys_content_t '/path/to/your/directory(/.*)?'
sudo restorecon -R /path/to/your/directory
```

### Generate html from markdown
```
python3 markdown_to_html.py <path1> <path2> ...
```

### Configure permissions and Nginx
See github.com/danbotMBM/danbotlab