# IDsChangesetsByUser + historial Who's That? local

Consulta y selecciona changesets de usuarios de OpenStreetMap sobre un mapa **OpenLayers WebGL**, un listado virtualizado y selección por lazo editable. La aplicación consulta usuarios y changesets mediante la API oficial de OpenStreetMap.

Los changesets con modificaciones y sin `bbox` se incluyen en «Todos los IDs» y en «Detalles» como **Sin ubicación**; se pueden seleccionar individualmente o por rango y abrir en OSM, pero no aparecen en el mapa ni se seleccionan mediante lazo. Cuando existen, un contador sobre el mapa permite filtrar el listado a esos cambios y volver a mostrar todos. Dentro del listado filtrado, `Ctrl+A` o `⌘+A` selecciona todos los cambios sin ubicación. Los changesets sin modificaciones y las coordenadas inválidas se registran en «Errores».

El historial de nombres **SQLite** se distribuye cifrado en `data/whosthat.db.gz.enc` (GZIP + AES-256-GCM).

**La web funciona sin contraseña ni descarga previa de SQLite.** Para consultar los nombres anteriores:

1. Carga un usuario OSM por UID o nombre.
2. Pulsa **«Nombres conocidos»** en «Información del Usuario».
3. Introduce la contraseña si no se ha recordado el acceso.
4. El navegador descargará, verificará, descifrará y abrirá la base local.

- **Recordar acceso en este navegador** almacena una clave de descifrado no exportable en IndexedDB.
- La base cifrada puede guardarse en IndexedDB; una publicación nueva se descarga si cambia su SHA-256.
- Las búsquedas de nombres históricos se realizan localmente por UID.

### Explorador histórico independiente

El botón **«⌕ Explorar»** junto a «Nombres conocidos» permite desbloquear la BD **sin cargar ningún usuario**. Abre un explorador con tres pestañas: búsqueda por nombre exacto, fragmento, prefijo o regex, exploración por fechas de observación y ranking de UID con más nombres distintos registrados. Las consultas se procesan en el trabajador SQLite y se muestran por páginas de 100 resultados. Al seleccionar un UID se muestran sus nombres históricos y se ofrece cargar sus changesets en el visor.

La primera y la última observación de cada nombre no son fechas exactas de renombrado. El ranking cuenta nombres distintos registrados por UID; no representa necesariamente todos sus cambios reales de nombre. Las búsquedas regex extensas pueden tardar más porque deben examinar los nombres de la base.

### Almacenamiento SQLite v2

La tabla `whosthat` guarda `user_id`, `user_name`, `date_first` y `date_span`. `date_first` es el número entero de días desde `2005-04-17` y `date_span` es la duración en días hasta la última observación. `metadata` guarda `sequenceNumber`, `schemaVersion=2` y `dateEpoch=2005-04-17`. La tabla utiliza `WITHOUT ROWID`, con clave primaria `(user_id,user_name)`, y no requiere índices adicionales. Solo se admite el formato v2.

### Migración única desde la base cifrada anterior

La conversión local se ejecuta una sola vez desde la raíz del repositorio:

```bash
python3 -m scripts.migrar_sqlite
```

El programa solicita la ruta de la base cifrada original si no está en `data/`, instala `cryptography` en un entorno virtual aislado si es necesario y pide la contraseña. Conserva intacto el fichero original y crea `data/migracion-v2/whosthat.db.gz.enc` y `data/migracion-v2/version.json`. Compara todos los registros y metadatos antes y después, además de verificar el descifrado de la salida.

**No reemplaces el Release en uso ni despliegues el código antes de preparar el Release v2:** el nuevo lector requiere el manifiesto y el SQLite migrado. Primero valida y publica ambos archivos migrados en un Release separado llamado `whosthat-data-v2`; después publica conjuntamente los cambios del repositorio. Los workflows nuevos leen y actualizan exclusivamente ese Release y comprueban el esquema v2, el tamaño y el SHA-256 del archivo cifrado. El Release anterior `whosthat-data` permanece intacto durante el cambio. Conserva una copia independiente de la base antigua hasta verificar el resultado en la web.

Desde la raíz del proyecto, tras finalizar la migración:

```bash
python3 -m scripts.validar_release data/migracion-v2
gh release create whosthat-data-v2 data/migracion-v2/whosthat.db.gz.enc data/migracion-v2/version.json --repo atarom/IDsChangesetsByUser --title "Who's That? SQLite v2" --notes "Base migrada a fechas relativas; inicio + duración desde 2005-04-17" --latest=false
```

Una vez que `whosthat-data-v2` contenga los dos archivos correctos, publica el código de esta versión. El despliegue de GitHub Pages descargará el Release v2; la actualización diaria continuará únicamente sobre v2.

## Privacidad y atribución

No publiques el SQLite descifrado. El cifrado protege frente a visitantes sin contraseña, pero **no impide a personas autorizadas extraer la información histórica completa**. Revisa los requisitos de privacidad y la legitimidad de compartir nombres antiguos con terceros. Los datos y las teselas proceden de [OpenStreetMap](https://www.openstreetmap.org/copyright); respeta sus condiciones y atribución.

**Agradecimiento:** A [Ilya Zverev (Zverik)](https://github.com/Zverik) por la idea original de [Who's That?](https://github.com/Zverik/whosthat), un proyecto para registrar y consultar el historial de nombres de usuarios de OpenStreetMap que ha inspirado la parte histórica de esta herramienta.
