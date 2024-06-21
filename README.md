# dmj_web 
This is a place for my random web development stuff.

### Generating certs for NGINX
```
sudo openssl req -newkey rsa:2048 -nodes -keyout /etc/nginx/ssl/selfsigned.key -out /etc/nginx/ssl/selfsigned.csr
sudo openssl x509 -signkey /etc/nginx/ssl/selfsigned.key -in /etc/nginx/ssl/selfsigned.csr -req -days 365 -out /etc/nginx/ssl/selfsigned.crt
```