FROM nginx:alpine

COPY _config/nginx.conf /etc/nginx/conf.d/default.conf

# Copy only the served files (no config/README in the web root)
COPY *.html *.png release.ver manifest.webmanifest sw.js /usr/share/nginx/html/
COPY js/    /usr/share/nginx/html/js/
COPY css/   /usr/share/nginx/html/css/
COPY icons/ /usr/share/nginx/html/icons/
COPY lang/  /usr/share/nginx/html/lang/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
