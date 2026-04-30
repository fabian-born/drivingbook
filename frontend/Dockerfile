FROM nginx:alpine

# Frontend Dateien kopieren
COPY . /usr/share/nginx/html

COPY _config/nginx.conf /etc/nginx/conf.d/default.conf

# Standard-Nginx-Port 80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
