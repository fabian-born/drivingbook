FROM nginx:alpine

# Frontend Dateien kopieren
COPY . /usr/share/nginx/html

# Standard-Nginx-Port 80
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
