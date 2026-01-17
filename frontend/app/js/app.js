cd ~/tesoura-v6 || exit 1

# garante a pasta
mkdir -p frontend/app/js

# faz o caminho /app/js/app.js apontar para o arquivo oficial (frontend/app.js)
ln -sf ../../app.js frontend/app/js/app.js

# checagens rápidas
ls -lah frontend/app.js frontend/app/js/app.js
