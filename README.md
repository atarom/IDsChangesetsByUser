# IDsChangesetsByUser + historial Who's That? local

Consulta y selecciona changesets de usuarios de OpenStreetMap sobre un mapa **OpenLayers WebGL**, con teselas OSM estándar oscurecidas mediante CSS, un listado virtualizado y selección por lazo editable. La aplicación consulta usuarios y changesets mediante la API oficial de OpenStreetMap, sin límite artificial de 5.000 cambios.

Los changesets con modificaciones y sin `bbox` se incluyen en «Todos los IDs» y en «Detalles» como **Sin ubicación**; se pueden seleccionar individualmente o por rango y abrir en OSM, pero no aparecen en el mapa ni se seleccionan mediante lazo. Cuando existen, un contador sobre el mapa permite filtrar el listado a esos cambios y volver a mostrar todos. Dentro del listado filtrado, `Ctrl+A` o `⌘+A` selecciona todos los cambios sin ubicación. Los changesets sin modificaciones y las coordenadas inválidas se registran en «Errores».

El historial de nombres **SQLite** se distribuye cifrado en `data/whosthat.db.gz.enc` (GZIP + AES-256-GCM). Las consultas históricas se ejecutan en el navegador, sin depender de la API de Who's That?.

**La web funciona sin contraseña ni descarga previa de SQLite.** Para consultar los nombres anteriores:

1. Carga un usuario OSM por UID o nombre.
2. Pulsa **«Nombres conocidos»** en «Información del Usuario».
3. Introduce la contraseña si no se ha recordado el acceso.
4. El navegador descargará, verificará, descifrará y abrirá la base local, si es necesario. Requiere RAM suficiente y un navegador moderno de escritorio.

- **Recordar acceso en este navegador** almacena una clave de descifrado no exportable en IndexedDB.
- La base cifrada puede guardarse en IndexedDB; una publicación nueva se descarga si cambia su SHA-256.
- Las búsquedas de nombres históricos se realizan localmente por UID.

### Explorador histórico independiente

El botón **«⌕ Explorar»** junto a «Nombres conocidos» permite desbloquear la BD **sin cargar ningún usuario**. Abre un explorador con tres pestañas: búsqueda por nombre exacto, fragmento, prefijo o regex (JavaScript), exploración por fechas de observación y ranking de UID con más nombres distintos registrados. Las consultas se procesan en el trabajador SQLite y se muestran por páginas de 100 resultados. Al seleccionar un UID se muestran sus nombres históricos y se ofrece cargar sus changesets en el visor.

Las fechas `date_first` y `date_last` indican primeras y últimas **observaciones**, no fechas exactas de renombrado. El ranking cuenta nombres distintos registrados por UID; no representa necesariamente todos sus cambios reales de nombre. Las búsquedas regex extensas pueden tardar más porque deben examinar los nombres de la base.

## Publicación

El workflow `deploy-pages.yml` publica GitHub Pages automáticamente al hacer `push` a `main` usando la última base cifrada de Releases, sin regenerarla. El workflow `actualizar-publicar.yml` actualiza la base diariamente o manualmente y también publica la web. Ambos comparten un grupo de concurrencia para evitar solapamientos.

## Privacidad y atribución

No publiques el SQLite descifrado. El cifrado protege frente a visitantes sin contraseña, pero **no impide a personas autorizadas extraer la información histórica completa**. Revisa los requisitos de privacidad y la legitimidad de compartir nombres antiguos con terceros. Los datos y las teselas proceden de [OpenStreetMap](https://www.openstreetmap.org/copyright); respeta sus condiciones y atribución.

**Agradecimiento:** A [Ilya Zverev (Zverik)](https://github.com/Zverik) por la idea original de [Who's That?](https://github.com/Zverik/whosthat), un proyecto para registrar y consultar el historial de nombres de usuarios de OpenStreetMap que ha inspirado la parte histórica de esta herramienta.
