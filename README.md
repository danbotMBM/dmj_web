# dmj_web 
This is a place for my random web development stuff.

### tools used
* Nginx for web server
* AWS ec2 for front and back end hosting
* Basic static client side html, css, and javascript
* Heavy usage of markdown with html conversion by [pycmarkgfm](https://github.com/Zopieux/pycmarkgfm) and css stolen from [github-markdown-css](https://github.com/sindresorhus/github-markdown-css?tab=readme-ov-file)

### the goal
Make a place for me to document project in the fastest and hopefully least ugly way possible.

# Setup

### Run ansible playbook
```
ansible-playbook -i inventory.yml server.yml
```