# Telegram, n8n y agentes

La integración es independiente del JWT de la aplicación. Cada clave pertenece al usuario que la creó y solo accede a sus datos. Las altas hechas mediante esta API quedan con origen `TELEGRAM` y pendientes de revisión. La clave debe guardarse en el servidor o gestor de credenciales de n8n, nunca en una aplicación cliente, prompt de un modelo ni repositorio.

## Crear una clave

1. Inicia sesión en la aplicación y abre Integración en Ajustes.
2. Genera una clave y copia el valor mostrado una sola vez a un lugar seguro.
3. Puedes revocarla desde la misma pantalla; el bot dejará de tener acceso.

## API para cualquier agente

Utiliza `X-API-Key: <clave>` sobre HTTPS en producción. Un cuerpo JSON de un movimiento tiene este formato:

```json
{
  "date": "2026-11-06",
  "amount": 2.5,
  "type": "EXPENSE",
  "concept": "Café",
  "account": "Efectivo",
  "notes": "Añadido por mi agente"
}
```

- `POST /api/integrations/telegram/movements` admite un objeto o un array de objetos para un lote.
- `amount` es positivo, expresado en euros con hasta dos decimales. `type` es `INCOME` o `EXPENSE`.
- `date` tiene formato `aaaa-mm-dd`; si se omite, la API utiliza la fecha actual.
- `account` y `category` pueden indicar un nombre existente o identificador. Comprueba los nombres de tu app. Si no indicas cuenta se selecciona la cuenta por defecto; si no indicas categoría se aplican las reglas de autocategorización y, si no coinciden, se marca para revisión sin categorizar.
- `GET /api/integrations/telegram/summary` consulta el resumen del mes actual. Admite los filtros de fecha documentados en la API principal.
- Un `401/403` requiere revisar la clave; un `429` exige esperar. Ante un timeout comprueba primero si el movimiento se guardó, en lugar de repetir una alta sin control.

Ejemplo local (la clave se lee de una variable, no se escribe literalmente en el historial):

```bash
curl --fail-with-body http://127.0.0.1:3001/api/integrations/telegram/movements \
  -H "X-API-Key: $FINANZAS_API_KEY" \
  -H 'Content-Type: application/json' \
  --data '{"date":"2026-11-06","amount":2.5,"type":"EXPENSE","concept":"Café"}'
```

No actives el trazado de shell (`set -x`) al utilizar credenciales.

## Bot incluido (grammY)

En la raíz del proyecto instala las dependencias con `npm ci`. Después:

```bash
cp telegram-bot/.env.example telegram-bot/.env
# Edita telegram-bot/.env de forma local, sin publicar sus valores.
npm run dev --workspace @finanzas/telegram-bot
```

Configura:

| Variable | Uso |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | Token de BotFather. Nunca lo envíes a la API financiera. |
| `FINANZAS_API_KEY` | Clave generada en la aplicación. |
| `FINANZAS_API_URL` | Origen del backend, por defecto `http://127.0.0.1:3001`. HTTPS obligatorio para servidores remotos. |
| `TELEGRAM_ALLOWED_USER_IDS` | IDs numéricos autorizados separados por comas. Obligatorio; el bot solo acepta chats privados. |
| `FINANZAS_DEFAULT_ACCOUNT` | Nombre o ID de una cuenta existente; opcional. |
| `FINANZAS_DEFAULT_CATEGORY` | Categoría fija; opcional. Deja vacío para usar las reglas de la app. |

El bot usa long polling y no necesita publicar un webhook. Solo debe ejecutarse una instancia por token. La salida de compilación se inicia con `npm run start --workspace @finanzas/telegram-bot`. Los procesos no sobreviven automáticamente a un reinicio del servidor; utiliza un supervisor en producción. El backend y el bot deben poder salir por HTTPS a la API de Telegram; la app funciona de manera independiente sin esas credenciales.

Mensajes soportados:

```text
café 2,50
nómina 1.800,00 ingreso
compra 45,90 05/11/2026
cine 12 ayer
/resumen
```

El parser rechaza fechas imposibles, importes ambiguos, mensajes con varios importes y monedas distintas al euro. Los importes sin palabra de tipo son gastos; añade `ingreso` para cobros. Confirma la interpretación en la bandeja de pendientes de la aplicación.

## Conectar un LLM o n8n

En n8n crea un flujo: **Telegram Trigger → filtro por usuario y chat privado → parser/agente → validación → HTTP Request**. Configura el nodo HTTP con método POST, URL fija de la API, cuerpo JSON del contrato anterior y credencial `X-API-Key` almacenada en el gestor de n8n. No permitas que el modelo seleccione la URL o construya encabezados. Para consultas usa el endpoint de resumen con la misma credencial, y transforma su respuesta en lenguaje natural sin enviar la clave al modelo.

Para ampliar el bot incluido, implementa `interpretWithAgent` en `telegram-bot/src/agent-hook.ts`. El hook está desactivado por defecto y devuelve `null`; solo se invoca si el parser simple no puede interpretar el mensaje. Devuelve un objeto del contrato y valida también en tu adaptador. El bot aplica Zod al resultado antes de enviarlo a una URL fija. No ejecutes código, instrucciones del usuario o herramientas propuestas por el modelo. Si hay dudas en el importe o fecha, pide aclaración en lugar de inventar datos. La implementación del proveedor LLM y sus credenciales son opcionales y no se incluyen en el ejemplo.

Añade confirmación humana antes del POST si tu agente interpreta mensajes libres. Conserva el `update_id` de Telegram en tu automatización para evitar procesar dos veces una entrega repetida. La API de altas no debe tratarse como idempotente: no repitas automáticamente solicitudes de escritura tras un timeout sin reconciliarlas con los movimientos existentes.
