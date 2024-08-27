1. Copy over configs
2. copy them to /etc/nginx/nginx.conf and /etc/nginx/conf.d/
3. Copy over the stuff for the websites
4. ensure the permissions for each file is appripriate
    ```
    all accessable files and directories should be owned by nginx and readable
    ```


### Instructions on how to get a cert from LetsEncrypt
[certbot installation](https://certbot.eff.org/instructions?ws=nginx&os=pip)
```
Saving debug log to /var/log/letsencrypt/letsencrypt.log
Please enter the domain name(s) you would like on your certificate (comma and/or
space separated) (Enter 'c' to cancel): danielmarkjones.com
Requesting a certificate for danielmarkjones.com

Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/danielmarkjones.com/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/danielmarkjones.com/privkey.pem
This certificate expires on 2024-11-22.
These files will be updated when the certificate renews.

NEXT STEPS:
- The certificate will need to be renewed before it expires. Certbot can automatically renew the certificate in the background, but you may need to take steps to enable that functionality. See https://certbot.org/renewal-setup for instructions.

- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
If you like Certbot, please consider supporting our work by:
 * Donating to ISRG / Let's Encrypt:   https://letsencrypt.org/donate
 * Donating to EFF:                    https://eff.org/donate-le
- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -
```
