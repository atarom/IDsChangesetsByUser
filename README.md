# IDsChangesetsByUser + historial Who's That? local

Integración con el historial de nombres **SQLite**, cifrado en un archivo `data/whosthat.db.gz.enc` (GZIP + AES-256-GCM). Elimina dependencia de la API `whosthat.osmz.ru`; las solicitudes para obtener usuarios y changesets siguen utilizando la API oficial de OpenStreetMap, y el mapa sigue utilizando MapLibre.

**La web arranca directamente sin pedir contraseña ni descargar la base.** La consulta de usuarios, changesets y el mapa funcionan sin habilitar el historial. Si quieres consultar los nombres antiguos:

1. Carga un usuario OSM normalmente (por UID o nombre).
2. Pulsa el enlace **«Nombres conocidos»** de la sección «Información del Usuario».
3. Solo entonces se comprueba el acceso recordado o se solicita la contraseña.
4. Si es necesario, el navegador descarga, descifra y descomprime el archivo y abre ~**SQLite**. Requiere RAM suficiente y un navegador moderno de escritorio.

- Si eliges «Recordar acceso en este navegador», se guarda una **clave de descifrado no exportable** en IndexedDB. Si no marcas esa opción, tendrás que introducir la contraseña otra vez al cerrar la página.
- La copia **cifrada** se guarda en la caché IndexedDB si hay espacio. Al publicar una nueva versión, se descarga una copia nueva, manteniendo el mismo cifrado/contraseña.
- Los cambios de nombre se consultan **localmente**, por UID. No se transmite ninguna búsqueda de nombres históricos a otra API.

## Privacidad y atribución

No publiques el SQLite descifrado. El cifrado protege frente a visitantes sin contraseña, pero **no impide a una persona autorizada obtener toda la información histórica**. Revisa los requisitos de privacidad y la legitimidad de compartir nombres antiguos con terceros, aunque sea con un grupo reducido. Respeta la atribución y condiciones aplicables a datos de OpenStreetMap.
