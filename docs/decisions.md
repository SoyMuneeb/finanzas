# Decisiones técnicas

- Importes EUR positivos con tipo `INCOME`/`EXPENSE`; almacenamiento en céntimos enteros, límite por registro de 10 millones de euros. La exportación usa importes con signo, evitando invertir gastos al reimportar.
- SQLite y Prisma 6.19 en modo oficial sin Rust, con adaptador libSQL y motor de esquema WASM. Las dependencias llegan por npm con verificación de integridad; no se desactivan comprobaciones TLS/checksum. La URL SQLite relativa se resuelve siempre respecto de `server/prisma/`.
- El modelo está separado por usuario. Registro inicial explícitamente habilitado y cerrado automáticamente después del primer usuario; no hay administración multiusuario en esta versión.
- Las claves de integración son aleatorias, se guardan mediante SHA-256 y solo se muestran al generarlas. Las copias JSON contienen todos los datos financieros, no sesiones, contraseñas ni claves API. La restauración conserva esas credenciales, reemplaza datos financieros en una transacción y reasigna identificadores.
- Las recurrencias conservan el día original (31 → último día de febrero → 31 de marzo). Un índice único evita materializar dos veces la misma ocurrencia. El servidor ejecuta pendientes al arrancar y cada minuto; se pueden ejecutar manualmente. Límite de recuperación de 500 por regla y ejecución.
- Los perfiles bancarios son heurísticas de encabezados, no conectores a bancos. El usuario revisa el mapeo y los errores antes de confirmar; no se interpretan fórmulas XLSX ni divisas distintas de EUR. No hay sincronización bancaria automática.
- Overrides de `deepmerge-ts`, `effect` y `uuid` actualizan dependencias transitivas con avisos de seguridad; la generación de Prisma, pruebas API y archivos XLSX se verifican con estas versiones.
- Recomendado un único proceso API con SQLite para despliegue personal. PostgreSQL requiere cambiar proveedor/adaptador y generar sus migraciones, no solo cambiar la URL. HTTPS y copias externas deben configurarse en el despliegue final.

## Validación de la entrega inicial

- Instalación limpia con `npm ci`, generación Prisma y build de los tres paquetes correctos.
- 94 pruebas: 49 de importación, 8 de presupuestos, 13 de API con SQLite aislado y 24 del parser Telegram. El cliente no tiene suite unitaria; se verificó mediante navegador real.
- Chromium: acceso, cinco secciones, alta/edición/borrado de un movimiento, modo oscuro y ancho móvil de 390 px sin desbordamiento ni errores de JavaScript.
- Migración inicial y repetición sin cambios verificadas. `npm audit`: 0 vulnerabilidades en el lockfile entregado.
- Compose validado sintácticamente; construcción y despliegue Docker no ejecutados. Bot sin conexión real porque no se han proporcionado credenciales de Telegram; parser y contrato HTTP sí probados.
