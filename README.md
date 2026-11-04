# IDsChangesetsByUser + historial Who's That? local

Integración de la interfaz original aportada con el historial de nombres **SQLite real**, cifrado en un archivo `data/whosthat.db.gz.enc` (GZIP + AES-256-GCM). Solo se elimina la dependencia de la API `whosthat.osmz.ru`; las solicitudes para obtener usuarios y changesets siguen utilizando la API oficial de OpenStreetMap, y el mapa sigue utilizando MapLibre.

## 1. Prueba local: un solo comando

Descomprime **todo** el ZIP. Abre un terminal en la carpeta que contiene `index.html` y ejecuta:

```bash
python3 -m http.server 8000
```

Abre **http://localhost:8000/** (no abras `index.html` mediante `file://`).

**La web arranca directamente sin pedir contraseña ni descargar la base.** La consulta de usuarios, changesets y el mapa funcionan sin habilitar el historial. Si quieres consultar los nombres antiguos:

1. Carga un usuario OSM normalmente (por UID o nombre).
2. Pulsa el enlace **«Nombres conocidos»** de la sección «Información del Usuario».
3. Solo entonces se comprueba el acceso recordado o se solicita la contraseña compartida (indicada en el mensaje de entrega, no dentro del ZIP).
4. Si es necesario, el navegador descarga unos **119 MiB**, descifra y descomprime el archivo y abre ~**296 MiB de SQLite**. Requiere RAM suficiente y un navegador moderno de escritorio.

**No hay botón «Bloquear»:** el historial se abre a demanda, y si está listo basta con pulsar el enlace para consultar otro UID. Si nunca usas el enlace, no se crea el Web Worker, no se consulta el manifiesto y no se descarga ningún dato histórico.

- Si eliges «Recordar acceso en este navegador», se guarda una **clave de descifrado no exportable** en IndexedDB. Si no marcas esa opción, tendrás que introducir la contraseña otra vez al cerrar la página.
- La copia **cifrada** se guarda en la caché IndexedDB si hay espacio. Al publicar una nueva versión, se descarga una copia nueva, manteniendo el mismo cifrado/contraseña.
- Los cambios de nombre se consultan **localmente**, por UID. No se transmite ninguna búsqueda de nombres históricos a otra API.
- Para utilizar los cambiosets y el mapa sí se requiere conexión a Internet, como en la aplicación original. La biblioteca SQLite WASM se descarga de `cdnjs.cloudflare.com` en la primera apertura (no se distribuye dentro del ZIP).
- No necesitas instalar paquetes de Python para **ver la web**: el comando `http.server` basta.

### Si no aparecen nombres

1. Introduce un UID de OpenStreetMap y pulsa «Cargar Changesets».
2. Pulsa **«Nombres conocidos»**: entonces se solicitará la contraseña o se reutilizará el acceso guardado.
3. En esa misma sección aparecerán los nombres y sus fechas observadas.
4. Si falla, comprueba la consola del navegador y el mensaje de la ventana de contraseña.

## 2. Contenido del proyecto

```text
index.html               Interfaz original, historial opcional mediante enlace.
css/style.css            Diseño original + ventana del historial cifrado.
js/app.js                Mapa, búsquedas, changesets y selección originales;
                         solo se sustituyó la consulta antigua de Who's That?.
js/database.js           API JS de consulta local.
js/db-worker.js          Descarga, IndexedDB, Web Crypto, GZIP y sql.js WASM.
js/db-ui.js              Ventana de contraseña solo bajo demanda.
data/whosthat.db.gz.enc  Base actualizada real comprimida y cifrada (~125 MB).
data/version.json        Versión, secuencia y checksum del cifrado.
scripts/crypto_db.py     Cifrado y descifrado desde Python.
scripts/actualizar_whosthat_rapido.py  Actualizador horario original de 4 workers.
scripts/actualizar_y_publicar.py      Actualiza la base cifrada para publicar.
.github/workflows/actualizar-publicar.yml  Plantilla GitHub Actions.
```

## 3. Actualizar manualmente la base cifrada

Esta operación es **opcional**. La prueba local ya contiene todos los cambios hasta la secuencia `123992`.

Para actualizar la base descargando nuevos diffs horarios, instala una dependencia **solo para el cifrado**:

```bash
python3 -m pip install -r requirements.txt
python3 scripts/actualizar_y_publicar.py --max-files 24 --workers 4
```

El segundo comando pregunta por la contraseña. Si quieres recuperar todos los cambios disponibles, omite `--max-files 24`. El programa trabaja con una SQLite temporal, la actualiza y comprueba su integridad; **solo al terminar** sustituye el archivo cifrado y el `version.json`.

Para cambiar la contraseña o recuperar SQLite, consulta:

```bash
python3 scripts/crypto_db.py --help
python3 scripts/crypto_db.py decrypt data/whosthat.db.gz.enc whosthat.sqlite
python3 scripts/crypto_db.py encrypt whosthat.sqlite data/whosthat.db.gz.enc --version data/version.json
```

**Atención:** si cambias la contraseña por una distinta, se genera una nueva clave y no funcionará el acceso recordado previamente en los navegadores. Los usuarios tendrán que volver a introducir la nueva contraseña.

## 4. GitHub Pages y actualización automática (fase siguiente)

El workflow `.github/workflows/actualizar-publicar.yml` está incluido para el despliegue posterior. **No se ha ejecutado ni probado en tu cuenta GitHub.** La web local es la parte que debes probar primero.

**IMPORTANTE: no subas el archivo `.enc` de 125 MB directamente a Git**: supera el límite de 100 MB por archivo. Está ignorado por `.gitignore`. Cuando decidas publicar:

1. Sube al repositorio vacío todos los archivos de este proyecto **menos** `data/whosthat.db.gz.enc` (el `.gitignore` lo excluye).
2. Crea un Release con tag `whosthat-data` y adjunta `data/whosthat.db.gz.enc` y `data/version.json`. Ejemplo con GitHub CLI después del primer push: `gh release create whosthat-data data/whosthat.db.gz.enc data/version.json --title 'Base cifrada' --notes 'Datos iniciales'`.
3. Configura `Settings → Secrets and variables → Actions → New repository secret` con el nombre `WHOSTHAT_DB_PASSWORD` y la contraseña compartida. **No la escribas en el código ni en el README del repositorio**.
4. Configura `Settings → Pages → Build and deployment → Source: GitHub Actions`.
5. Inicia el workflow manualmente desde Actions. Después queda previsto para ejecutarse una vez al día, procesando **los archivos horarios pendientes** (no los archivos diarios).

El workflow descarga el último archivo `.enc` desde GitHub Releases, descifra y actualiza una copia temporal, verifica SQLite, lo vuelve a cifrar, sustituye el asset en Releases y publica la web con GitHub Pages. Las copias anteriores no se mantienen automáticamente; haz **copias de seguridad externas periódicas** del `.enc` y del manifiesto. La operación `gh release upload --clobber` borra primero el asset anterior: un error de subida podría exigir restaurar una copia de seguridad.

**Limitaciones:** el sitio de GitHub Pages es público, pero el contenido de la base permanece cifrado. Las personas que conozcan la contraseña pueden descifrar y redistribuir la base completa. Esta solución solo es adecuada si se asume ese modelo de distribución y sus implicaciones de privacidad. GitHub Actions y Pages están sujetos a límites de almacenamiento, transferencia y tiempo.

## 5. Notas técnicas

- Formato `WTHDB01`: cabecera de 8 bytes, sal PBKDF2 de 16 bytes, IV aleatorio de 12 bytes, contenido `gzip(sqlite)` cifrado con AES-256-GCM (etiqueta de 16 bytes al final).
- Derivación: PBKDF2-HMAC-SHA256, 200.000 iteraciones. Mantiene la sal al actualizar para que pueda reutilizarse el acceso recordado; cambia el IV aleatorio en cada publicación.
- Índice SQLite por `(user_id, user_name)` y fechas de observación `date_first`, `date_last`. **No indican necesariamente la fecha exacta de cambio de nombre**, solo fechas de ediciones donde apareció ese nombre.
- `database.js` utiliza un Web Worker para no congelar el mapa durante el procesamiento, aunque la apertura requiere memoria considerable.
- Si el navegador elimina datos de IndexedDB por falta de espacio o limpieza, habrá que volver a descargar y/o introducir la contraseña.
- Para actualizar desde GitHub Actions por primera vez se necesita una configuración manual; la entrega no crea automáticamente tu repositorio ni cambia tu cuenta.

## 6. Privacidad y atribución

No publiques el SQLite descifrado. El cifrado protege frente a visitantes sin contraseña, pero **no impide a una persona autorizada obtener toda la información histórica**. Revisa los requisitos de privacidad y la legitimidad de compartir nombres antiguos con terceros, aunque sea con un grupo reducido. Respeta la atribución y condiciones aplicables a datos de OpenStreetMap y al código reutilizado.
