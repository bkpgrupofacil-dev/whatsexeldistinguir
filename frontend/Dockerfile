FROM nginx:1.27-alpine
ENV BACKEND_URL=http://backend:3000 NGINX_ENVSUBST_FILTER=BACKEND_URL
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY 10-senha.sh /docker-entrypoint.d/10-senha.sh
COPY public /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/saude || exit 1
