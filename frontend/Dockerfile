FROM nginx:alpine

COPY _config/nginx.conf /etc/nginx/conf.d/default.conf

# Nur die ausgelieferten Dateien kopieren (keine Konfiguration/README im Web-Root)
COPY *.html *.png release.ver manifest.webmanifest sw.js /usr/share/nginx/html/
COPY js/    /usr/share/nginx/html/js/
COPY icons/ /usr/share/nginx/html/icons/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
