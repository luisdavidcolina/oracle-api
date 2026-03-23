
# Oracle <-> Workforce Integration

Este proyecto implementa dos integraciones principales entre Workforce y Oracle:

## 1. Envío de estadísticas (Oracle → Workforce)

Scripts automatizados consultan la API de Oracle, transforman los datos y los publican en Workforce. El flujo principal se ejecuta con:

```bash
node src/scripts/sync_stats_all_stores.js --date YYYY-MM-DD --publish
```

**Características clave:**
- Consulta datos de ventas y cuentas por tienda/canal usando la API de Oracle BI.
- Segrega productos/items exclusivamente por _family group_ (grupo familiar) según el catálogo de Oracle.
- Publica los datos en Workforce usando el mapeo definido en `datastreams.json`.
- Genera logs y archivos de traza por cada corrida en la carpeta `logs/`.
- Si se omite `--publish`, realiza solo simulación (dry-run).

**Argumentos principales:**
- `--date YYYY-MM-DD` (o `--busDate`): Fecha de negocio a consultar.
- `--locRef XXXXX`: Referencia de tienda específica (opcional).
- `--publish`: Publica los datos en Workforce.
- `--checks-mode [auto|strict|menuitems]`: Controla la lógica de conteo de checks.

**Ejemplo de ejecución:**
```bash
node src/scripts/sync_stats_all_stores.js --date 2026-03-20 --publish
```

**Notas técnicas:**
- El mapeo de productos depende 100% del _family group_ reportado por Oracle. Si no existe, el producto se omite.
- Mantén actualizado el archivo `datastreams.json` para evitar pérdidas de datos.
- El script imprime en consola la ruta y parámetros del endpoint consultado.
- Los archivos de respuesta cruda se guardan como `oracle_raw_quarterhour_{locRef}_{fecha}.json`.

**Comandos útiles:**
- Ejecutar para todas las tiendas:
  ```bash
  node src/scripts/sync_oracle_all_metrics.js --date 2026-03-20 --publish
  ```
- Ejecutar para una tienda específica:
  ```bash
  node src/scripts/sync_stats_all_stores.js --date 2026-03-20 --locRef 29402 --publish
  ```

## 2. Recepción de webhooks de usuarios (Workforce → Oracle)

Un endpoint HTTP recibe eventos de usuarios creados o modificados en Workforce. El sistema identifica el tipo de acción y conecta con la API Labor de Oracle (diferente a la de estadísticas) para crear o modificar el usuario.

**Endpoint:**
- `POST /starbucks/oracle-user-sync`


**Flujo:**
1. Workforce dispara un webhook cuando un usuario es creado o modificado.
2. El endpoint recibe el evento y valida el payload.
3. Se determina si es alta o modificación.
4. **(Nuevo flujo recomendado y requerido):**
  - El payload recibido puede ser parcial (por ejemplo, no incluye equipos del empleado ni otros datos que pueden cambiar).
  - Tras recibir el webhook, el sistema debe realizar llamadas adicionales para obtener toda la información completa y actualizada del empleado (por ejemplo, consultar a otros sistemas o APIs internas).
  - Con toda la información reunida, se debe buscar al empleado en Oracle (GET) y comparar los datos actuales en Oracle con los datos completos obtenidos.
  - Si existen diferencias, se debe realizar la actualización correspondiente en Oracle (PUT u operación equivalente).
  - Solo se actualiza en Oracle si hay cambios detectados.
5. Se registra el resultado y errores.

> **Nota:** Este flujo debe implementarse como parte funcional del endpoint, ya que es necesario para asegurar que Oracle siempre tenga la información más actualizada y completa del empleado, incluso si el webhook inicial no contiene todos los datos relevantes.

**Payload mínimo sugerido:**
```json
{
  "user": {
    "employee_id": "EMP-12345",
    "legal_first_name": "Juan",
    "legal_last_name": "Perez",
    "date_of_birth": "1990-01-01",
    "employment_start_date": "2026-03-20",
    "passcode": "1234",
    "user_levels": ["employee"]
  },
  "locationRef": "4000004"
}
```

**Seguridad:**
- Si defines la variable de entorno `ORACLE_USER_SYNC_ENDPOINT_TOKEN`, el endpoint exige autenticación por header `x-oracle-user-sync-token` o `Authorization: Bearer <token>`.

**Notas técnicas:**
- El endpoint está implementado en `src/controllers/oracle-user.controller.js` y `src/services/oracle-user.service.js`.
- Usa la API Labor de Oracle (no la de estadísticas/BI).
- Soporta alta y modificación automática por `externalPayrollID`.

## 3. Consideraciones generales y troubleshooting

- Mantén actualizado el catálogo de _family group_ y el archivo `datastreams.json`.
- Si falta un datastream, la tienda/canal se omite sin fallar toda la corrida.
- Los logs y archivos de traza ayudan a depurar y validar los datos reales enviados.
- El script y el endpoint usan APIs distintas de Oracle (BI para stats, Labor para usuarios).

## 4. Archivos clave

- `src/app.js`: Configuración Express y middlewares.
- `src/server.js`: Arranque del servicio.
- `src/controllers/integration.controller.js`: Entrada del webhook de estadísticas.
- `src/controllers/oracle-user.controller.js`: Entrada del webhook de usuarios.
- `src/services/workforce.service.js`: Transformación y armado del payload Workforce.
- `src/services/api.service.js`: Publicación a Workforce API.
- `src/scripts/sync_stats_all_stores.js`: Script principal de estadísticas.
- `src/scripts/sync_oracle_all_metrics.js`: Script unificado para todas las métricas.
- `src/config/datastreams.json`: Mapa de datastreams usado en la transformación.

## 5. Ejecución local

```bash
npm install
npm run dev
# o
npm start
```

## 6. Pendientes y mejoras futuras

- Robustecer validación de payloads y cobertura de datastreams.
- Mejorar observabilidad de errores por tienda y lote.
- Implementar reintentos automáticos y auditoría persistente.
- Mover credenciales y tokens a variables de entorno.

### Pendientes técnicos en el endpoint de sincronización de usuarios (Workforce → Oracle Labor)

- Implementar la obtención de datos adicionales del empleado tras recibir el webhook (por ejemplo, equipos, roles, etc.)
- Implementar la obtención de todos los datos actuales del empleado desde Oracle Labor (no solo existencia)
- Implementar la comparación profunda entre los datos completos (payload + adicionales) y los datos actuales en Oracle Labor
- Realizar la actualización en Oracle Labor solo si se detectan cambios
- Documentar y/o parametrizar las fuentes de datos adicionales si aplica

---

Para dudas o troubleshooting, revisa los logs generados y los archivos de respuesta cruda. Si tienes dudas sobre el mapeo de nombres comerciales a claves técnicas, revisa `datastreams.json`.
5. Planificar limpieza de codigo legado en una fase separada.