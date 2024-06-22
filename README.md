# dmj_web 
This is a place for my random web development stuff.



### copy everthing over
```
cd dmj_web
sudo dnf install nginx
sudo cp nginx.conf /etc/nginx/nginx.conf
sudo mkdir -p /data/dmj_web
sudo cp -r * /data/dmj_web/
```

### Generating certs for NGINX
```
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -newkey rsa:2048 -nodes -keyout /etc/nginx/ssl/selfsigned.key -out /etc/nginx/ssl/selfsigned.csr
sudo openssl x509 -signkey /etc/nginx/ssl/selfsigned.key -in /etc/nginx/ssl/selfsigned.csr -req -days 365 -out /etc/nginx/ssl/selfsigned.crt
sudo nginx -t
sudo systemctl restart nginx
```

### open firewall
```
sudo dnf install firewalld
sudo systemctl daemon-reload
sudo systemctl enable firewalld
sudo systemctl start firewalld
sudo firewall-cmd --permanent --zone=public --add-service=http
sudo firewall-cmd --permanent --zone=public --add-service=https
sudo firewall-cmd --reload
```

### add user
```
sudo useradd -r -s /sbin/nologin www-data
sudo chown -R www-data:www-data /var/log/nginx
sudo chown -R www-data:www-data /data
sudo systemctl restart nginx
```