# Finanzas

Aplicación de finanzas personales en español: movimientos, gráficos, presupuestos, importación de extractos y API para Telegram o agentes. Funciona en local con SQLite y dispone de configuración de despliegue con Docker Compose.

## Arquitectura

- **`client/`**: React, TypeScript estricto, Vite, Tailwind CSS y Recharts. Interfaz adaptable, modo oscuro, importación guiada y formularios en español.
- **`server/`**: Express 5, TypeScript, Prisma, SQLite, validación Zod, JWT y bcrypt. El adaptador libSQL de Prisma mantiene SQLite local sin depender de la descarga de motores binarios. Los importes se almacenan como **céntimos enteros**, las fechas como `YYYY-MM-DD` y todas las consultas se restringen al usuario autenticado.
- **`telegram-bot/`**: bot grammY con parser español y un hook tipado para añadir un LLM. Se ejecuta por separado.
- **`docs/telegram.md`**: conexión de Telegram, n8n y agentes.

La primera versión permite registrar **un primer usuario**; después se cierra el registro, aunque `ALLOW_REGISTRATION=true`. El esquema y el aislamiento de datos admiten múltiples usuarios, pero no se incluye administración de altas adicionales. No hay servicios externos obligatorios para ejecutar la aplicación web.

## Instalación local

Requisitos: Node.js **22.12 o posterior**, npm y Git. Ejecuta desde la raíz del repositorio:

```bash
npm ci
cp server/.env.example server/.env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

Copia el último valor a `JWT_SECRET` en **`server/.env`**. No uses el texto de ejemplo ni lo publiques. Mantén `ALLOW_REGISTRATION=true` para crear tu usuario desde la interfaz; tras registrarlo, cambia a `false` y reinicia el servidor.

```bash
npm run db:generate -w server
npm run db:migrate
npm run dev
```

Vite sirve el frontend en el puerto **5173** y redirige `/api` al backend en **3001**. Abre la aplicación en tu navegador usando esos puertos de tu máquina local. El archivo SQLite local se crea en `server/prisma/dev.db`. Si necesitas un puerto API distinto, actualiza también el proxy de `client/vite.config.ts`.

### Datos de ejemplo

Sobre una base vacía, puedes crear un usuario de demostración y hasta doce meses de movimientos y presupuestos:

```bash
SEED_PASSWORD='elige-una-contraseña-de-al-menos-12-caracteres' npm run seed
```

El correo predeterminado es `demo@finanzas.local`; puedes cambiarlo con `SEED_EMAIL`. En PowerShell, asigna `$env:SEED_PASSWORD` antes de ejecutar `npm run seed`. No hay contraseña predeterminada. El seed omite un usuario que ya exista para conservar sus datos. Crea el usuario con el seed **o** mediante registro inicial; el seed rechaza crear otro usuario si la base ya tiene uno con otro correo.

### Comandos

| Comando | Función |
| --- | --- |
| `npm run dev` | API con recarga y frontend Vite |
| `npm run build` | Compila TypeScript y genera los tres paquetes |
| `npm test` | Tests de importación, presupuestos, API y parser del bot |
| `npm run db:generate -w server` | Genera el cliente Prisma |
| `npm run db:migrate` | Aplica las migraciones versionadas pendientes |
| `npm run db:push` | Sincroniza el esquema solo para prototipos locales |
| `npm run seed` | Datos de ejemplo; requiere `SEED_PASSWORD` |
| `npm run start -w server` | Ejecuta la API compilada |
| `npm run dev -w telegram-bot` | Ejecuta el bot configurado por separado |

La instalación incluye una migración inicial versionada. `db:migrate` aplica únicamente las migraciones pendientes y puede repetirse al arrancar. Antes de evolucionar un despliegue con datos, crea y revisa la siguiente migración y realiza una copia de seguridad; no aceptes pérdidas de datos automáticamente. Reserva `db:push` para experimentar con bases locales desechables. Para migrar a PostgreSQL, cambia el provider del datasource y el adaptador a `@prisma/adapter-pg`, crea migraciones para PostgreSQL, migra los datos y valida sus restricciones. No basta con cambiar `DATABASE_URL`.

## Variables de entorno

El servidor carga `server/.env` cuando se ejecuta con los scripts del workspace. Las variables proporcionadas por el proceso tienen prioridad.

| Variable | Valor / propósito |
| --- | --- |
| `DATABASE_URL` | `file:./dev.db` en local; relativa al esquema Prisma |
| `JWT_SECRET` | Secreto aleatorio de al menos 32 caracteres; obligatorio |
| `PORT` | `3001` |
| `CORS_ORIGIN` | Orígenes exactos separados por comas, sin espacios; predeterminado `http://localhost:5173` |
| `ALLOW_REGISTRATION` | `true` solo para el alta inicial; el resto del tiempo `false` |
| `SEED_EMAIL` | Solo seed; predeterminado `demo@finanzas.local` |
| `SEED_PASSWORD` | Solo seed; mínimo 12 caracteres y máximo 72 bytes UTF-8 |

No incluyas secretos en variables `VITE_*`: forman parte del JavaScript público. Las claves de integración se generan en la interfaz, se muestran una sola vez y se guardan como hash en el servidor. El bot usa su propio archivo `telegram-bot/.env`, documentado en su ejemplo y en la [guía de Telegram](docs/telegram.md).

## Uso

### Dashboard y movimientos

Filtra por mes, trimestre, año o rango personalizado, cuenta y categoría. El dashboard muestra ingresos, gastos, balance del periodo, tasa de ahorro, comparativa mensual, distribución de gastos y balance acumulado. Este último incluye el saldo inicial de las cuentas y los movimientos anteriores al rango.

En Movimientos puedes buscar, ordenar y paginar; añadir, editar, eliminar con confirmación o seleccionar varios para borrado múltiple. Cada registro conserva origen y notas. Los movimientos de Telegram entran en **Pendientes de revisión**; revisarlos no altera el origen. Los formularios usan euros y la API devuelve importes con sufijo `Cents`.

En Ajustes puedes gestionar cuentas, categorías con nombre/color/icono y jerarquía, reglas por palabra clave y recurrencias semanales, mensuales o anuales. Las reglas se comparan sin distinguir mayúsculas ni acentos. Las recurrencias se generan al arrancar el servidor y cada minuto; existe además un endpoint para ejecutarlas. Se conservan en SQLite y las ocurrencias se identifican de forma única. Si una fecha mensual no existe, se usa el último día del mes; cada ejecución recupera hasta 500 fechas por recurrencia.

### Presupuestos

Crea límites mensuales o anuales, globales o por categoría. El gasto real suma únicamente gastos dentro del periodo y la categoría correspondiente. Las barras pasan a ámbar al **80 %** y rojo al **100 %**; un exceso conserva su porcentaje real. La copia del mes anterior omite presupuestos ya existentes en destino. Los presupuestos globales y por categoría son perspectivas independientes y no se suman entre sí.

### Importación y exportación

El asistente acepta **CSV y XLSX**, con perfiles de BBVA, Santander, CaixaBank, Sabadell, ING, Revolut y N26, además del genérico. Los perfiles detectan nombres de columnas habituales; revisa siempre la previsualización y el mapeo porque cada entidad cambia sus extractos y puede ofrecer varios formatos.

1. Elige la cuenta y el perfil y sube el archivo.
2. Revisa las columnas de fecha, concepto, importe y signo; también se admiten columnas separadas de ingreso/gasto.
3. Comprueba fechas, importes, errores por fila y duplicados antes de confirmar. Las filas inválidas no se importan.
4. Decide si omitir los duplicados. Se aplican las reglas de autocategorización al confirmar.

Se admiten fechas españolas, coma decimal, separadores de miles y codificaciones habituales UTF-8, Windows-1252 y UTF-16. El límite HTTP es **8 MB** y **10.000 filas válidas por importación**. XLSX utiliza la primera hoja; exporta fórmulas como valores antes de importar. Solo se admite **EUR** y se rechazan divisas distintas cuando el extracto las identifica. No se incluyen XLS antiguo, OFX ni Norma 43.

La detección usa un hash normalizado de fecha, importe, tipo, concepto y cuenta; también detecta repetidos dentro del mismo archivo. Dos operaciones reales idénticas pueden compartir hash: en ese caso, elige importar igualmente. Exporta CSV o XLSX con los filtros actuales. El CSV usa `;`, coma decimal y BOM UTF-8. Se neutralizan valores que una hoja de cálculo podría interpretar como fórmula.

### Copias JSON

La copia contiene **todos los datos financieros del usuario**: cuentas y saldos iniciales, categorías, reglas, presupuestos, recurrencias y movimientos. No contiene contraseñas, sesiones ni claves de API. Guárdala con protección adecuada porque incluye información financiera personal.

La restauración valida referencias y se ejecuta en una transacción: **reemplaza los datos financieros del usuario actual**. No añade los datos a los existentes. Mantiene las credenciales y claves del usuario y genera nuevos IDs internos para evitar colisiones entre usuarios. Descarga una copia actual antes de restaurar otra.

## API

Todas las rutas de aplicación requieren `Authorization: Bearer <JWT>` salvo salud, registro/login e integración Telegram. Las rutas Telegram usan `X-API-Key: <clave>` y no aceptan esa clave en la URL. Fechas: `YYYY-MM-DD`; importes de entrada: euros positivos con máximo dos decimales; tipos: `INCOME` o `EXPENSE`.

| Método y ruta | Entrada / resultado |
| --- | --- |
| `GET /api/health` | Comprueba también la conexión con SQLite |
| `POST /api/auth/register` | `{email,password}`; contraseña de al menos 12 caracteres y máximo 72 bytes UTF-8; solo primer usuario y registro habilitado |
| `POST /api/auth/login` | `{email,password}` → `{token,user}`; JWT válido 12 h |
| `GET /api/auth/me` | Usuario actual sin hash de contraseña |
| `GET /api/dashboard` | Resumen, series mensuales, categorías, balance y pendientes |
| `GET /api/movements` | `{items,total,page,pageSize}`; búsqueda, filtros, orden y paginación |
| `POST /api/movements` | `{date,concept,amount,type,accountId,categoryId?,notes?}` |
| `PUT /api/movements/:id` | Mismos campos; `reviewPending:false` para marcar revisado |
| `DELETE /api/movements/:id` | Elimina un movimiento propio |
| `POST /api/movements/bulk-delete` | `{ids:[...]}`; máximo 500 IDs |
| `GET/POST /api/accounts` | Lista / crea con `{name,initialBalance?}` |
| `PUT/DELETE /api/accounts/:id` | Edita / elimina; cuentas con movimientos o recurrencias no se eliminan |
| `GET/POST /api/categories` | Lista / crea con `{name,color?,icon?,type?,parentId?}` |
| `PUT/DELETE /api/categories/:id` | Edita / elimina; movimientos quedan sin categoría |
| `GET/POST /api/rules` | Lista / crea con `{keyword,categoryId}` |
| `PUT/DELETE /api/rules/:id` | Edita / elimina regla |
| `GET/POST /api/budgets` | Lista (`year`,`month`) / crea con `{period,year,month?,amount,categoryId?}` |
| `PUT/DELETE /api/budgets/:id` | Edita / elimina presupuesto; periodos `MONTHLY` / `YEARLY` |
| `POST /api/budgets/copy` | `{fromMonth:"2026-10",toMonth:"2026-11"}` |
| `GET/POST /api/recurrences` | Lista / crea: movimiento sin `date`, más `{frequency,nextDate,active?}` |
| `PUT/DELETE /api/recurrences/:id` | Edita / elimina; frecuencia `WEEKLY`, `MONTHLY` o `YEARLY` |
| `POST /api/recurrences/run` | Genera las recurrencias vencidas del usuario |
| `GET /api/import/profiles` | Perfiles disponibles |
| `POST /api/import/preview` | Multipart: `file`, `accountId`, `profile`, `mapping?` como JSON; devuelve filas, errores y duplicados |
| `POST /api/import/confirm` | `{accountId,rows,skipDuplicates}`; filas validadas de previsualización |
| `GET /api/export?format=csv` | Archivo CSV o XLSX (`format=xlsx`) con filtros |
| `GET /api/backup` | Descarga JSON financiero |
| `POST /api/backup` | Restaura el JSON completo y reemplaza los datos actuales |
| `GET/POST /api/integrations/keys` | Lista metadatos / genera con `{name}`; clave visible una sola vez |
| `DELETE /api/integrations/keys/:id` | Revoca inmediatamente la clave |
| `POST /api/integrations/telegram/movements` | Un movimiento o array de hasta 200; autenticación por API key |
| `GET /api/integrations/telegram/summary` | Mismo resumen que dashboard; admite filtros por fecha/cuenta/categoría |

Filtros comunes para dashboard, movimientos y exportación: `from`, `to`, `accountId`, `categoryId`, `search`, `type`, `source` (`MANUAL`, `TELEGRAM`, `IMPORT`) y `reviewPending` (`true`/`false`). Movimientos añade `page`, `pageSize` (máx. 100), `sort` (`date`, `amountCents`, `concept`, `type`, `createdAt`) y `order` (`asc`/`desc`). Las respuestas de error tienen `{error}` y, en validaciones, `details`. Los IDs se obtienen de las listas correspondientes.

### Telegram y agentes

Genera una clave desde la interfaz y configura tu cliente para mantenerla en un almacén de secretos. Ejemplo con variables locales ya configuradas:

```bash
curl -X POST "$FINANZAS_API_URL/api/integrations/telegram/movements" \
  -H "X-API-Key: $FINANZAS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-11-06","amount":2.50,"type":"EXPENSE","concept":"Café","account":"Cuenta principal","notes":"Registrado por el agente"}'

curl "$FINANZAS_API_URL/api/integrations/telegram/summary?from=2026-11-01&to=2026-11-30" \
  -H "X-API-Key: $FINANZAS_API_KEY"
```

`date` es opcional en Telegram y usa la fecha UTC del servidor si se omite. `account` y `category` admiten nombre o ID propio; si no hay cuenta explícita, la API selecciona una cuenta del usuario. Si falta categoría, aplica reglas o deja el movimiento sin categorizar. Todos los movimientos de Telegram quedan pendientes de revisión. Un array se valida por completo antes de guardar el lote. No existe clave de idempotencia para este endpoint: evita reintentos automáticos de escritura sin comprobar el resultado.

El bot interpreta «café 2,50» y «nómina 1800 ingreso», consulta `/resumen`, solo admite chats privados y exige una lista de usuarios autorizados. El hook LLM está desactivado inicialmente. La [guía completa](docs/telegram.md) incluye configuración, política de privacidad y conexión de n8n/LLM.

## Docker Compose

Incluye dos servicios: nginx para los archivos estáticos y `/api`, y Node para la API. SQLite se conserva en el volumen `finance-data`; la API no publica un puerto directo al host.

```bash
cp deploy/.env.example .env
# Edita .env: JWT_SECRET aleatorio; ALLOW_REGISTRATION=true solo para el alta inicial.
docker compose up --build -d
```

La web utiliza el puerto **8080**, configurable con `WEB_PORT`. Crea el primer usuario, cambia `ALLOW_REGISTRATION=false` en `.env` y aplica `docker compose up -d`. Para datos de ejemplo en un entorno vacío:

```bash
docker compose exec -e SEED_PASSWORD='elige-una-contraseña-de-al-menos-12-caracteres' server npm run seed
```

El contenedor servidor ejecuta `db:migrate` al arrancar y aplica las migraciones versionadas pendientes; revisa cada migración y realiza una copia de seguridad antes de actualizar un despliegue con datos. No borres el volumen al actualizar. Puedes detener con `docker compose down`; `down -v` elimina los datos. El Dockerfile usa dependencias completas en el servidor para disponer del CLI Prisma durante el arranque.

Para publicar en Internet, configura HTTPS delante de nginx, ajusta `CORS_ORIGIN`, protege el volumen y establece copias de seguridad externas. El bot puede ejecutarse en otro proceso configurando `FINANZAS_API_URL` con el origen HTTPS público. La limitación de peticiones de esta configuración se aplica a la dirección del proxy; para múltiples usuarios/instancias, configura y prueba una cadena de proxies de confianza y un almacén de rate limiting compartido. SQLite está pensado aquí para una instancia de API.

## Validación, decisiones y alcance

`npm test` cubre los formatos de extractos, fechas/importes malformados, duplicados, presupuestos, integración de API y parser de Telegram. `npm run build` comprueba los tres paquetes con TypeScript y genera la web de producción. El ejemplo de Telegram requiere credenciales reales para probar el intercambio con Telegram; no se conectan servicios externos durante los tests.

Se incluyen modo oscuro, interfaz responsive y recurrencias. Se dejan fuera de esta versión OFX/Norma 43, divisas y conversión, tickets adjuntos, metas de ahorro, informes PDF, auditoría persistente y PWA instalable. La API para agentes está preparada, pero la conexión concreta a un proveedor LLM es opcional y debe configurarse en el hook. Las plantillas Docker se proporcionan para despliegue posterior; la validación local de la aplicación no implica que se haya probado una publicación real.
