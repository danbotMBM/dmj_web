# Elegant and Simple Self-Hosting with DDNS
> Written March 2025

## Why Self-Host
As a kid, I used to always want to make a website and share stuff with friends and family.
I'd set up something on my computer but had no idea how to put it on the internet.
Recently, I've realized those childhood dreams by setting up an old gaming rig in my basement to host this website, projects, and services.
Throughout my schooling, I had experience with making a site and deploying it in the cloud, but it just pains me to pay $25 a month to Jeff Bezos to host my crappy website on a teeny processor.
So I went down the scary but surprisingly documented path of directing network traffic into my home.
I wanted a solution that provides simplicity, privacy, and most importantly cost saving.
Through my research, I decided to use dynamic DNS and a cloudflare proxy as that solution.
Learning and implementing a dynamic dns solution has been easy, cheap, and most importantly **FREE**.

## DDNS Debrief
So a quick rundown on Dynamic DNS. 
Dynamic DNS is a program you run on your server that will check its own DNS resolution periodically.
If it resolves to itself, then nothing happens.
Otherwise the DNS A record (maps the domain name to the ip) needs to be updated.
Dynamic DNS solutions detect this need for change and communicate with DNS providers to make it happen.

## Why Cloudflare DDNS
Dynamic DNS with cloudflare provides the perfect suite of features for the average self hosting person, providing a simple, free solution with extra quality of life features from cloudflare.
Dynamic DNS allows for externally routable domains without the need for contacting your ISP.
After paying too much for high-bandwidth fiber internet, I really did not want to pay for egress fees on cloud services.
With DDNS, I can just utilize the internet I already pay for to host all my services.
Also, cloudflare provides essential security features for any average home lab use case.
Cloudflare provides a free proxying service, which obscures your IP address from the people accessing your site.
This reduces the risk of any geo-locating or intense tracking.
Cloudflare also has some other awesome features including, cheap .com domain names, DDOS protection, and caching.
To make DDNS happen I've added a docker container to my server made by onzu.
This container uses an API key to change the A record for your DNS, which is the mechanism of the DDNS process.
Essentially, cloudflare's free proxy and programmable API allows for DDNS to be simple, free, and private.

## The Downsides
However, there are a few downsides to this solution.
There is good reason that companies uses static IP addresses.
The largest downside is that the DDNS uses a fixed-interval polling to check if the IP has changes.
This can cause a period of downtime where your services are routing to your old IP until the DDNS realizes the issue.
For my specific solution, the IP is checked by a cron job every 5 minutes, and, so far, I haven't noticed any downtime.
Also, cloudflare's free proxy does not allow arbitrary ports.
Only web traffic through port 80 and port 443 are allowed.
However, you can upgrade your plan to avoid that problem.

## Verdict
Overall, this setup has met all of the needs for my simple homelab.
* ✅ No cloud compute or networking costs
* ✅ Proxying for privacy
* ✅ Low maintenance effort 
* ❌ Potential small availability gap

(with some bonuses)
* 💫 Caching
* 💫 DDOS protection
* 💫 Globally recognized DNS
* 💫 Cheap domain registration

## Sources
* [ONZU Cloudflare Docker DDNS](https://github.com/oznu/docker-cloudflare-ddns)
* [Secure Homelab Architecture Youtube Explanation](https://youtu.be/Cs8yOmTJNYQ?si=YnKo0lSEIoof3pS5&t=614)