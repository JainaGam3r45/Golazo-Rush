# Golazo Rush

Mini-juego de fútbol arcade con Astro y Phaser. Juega partidos rápidos, marca goles y consulta el ranking mundial de selecciones.

Proyecto de JainaGam3r45 con apoyo de JiferCloud Hosting.

## Instalación

```bash
pnpm install
pnpm dev
```

Abre [http://localhost:4321](http://localhost:4321) en el navegador.

## Páginas

- `/` — Inicio con estadísticas, mejores selecciones, actividad reciente y lobby en vivo
- `/play` — Flujo de partido: elegir selección → previa (rival y duración) → jugar → resultado local
- `/ranking` — Ranking mundial de selecciones

## Flujo de juego

1. En `/play`, elige tu selección (se guarda en el navegador).
2. Revisa la previa: rival aleatorio, duración (1, 2 o 3 minutos) y pulsa **Jugar**.
3. Controla con WASD, sprint con Shift y patea con Espacio (mantén para cargar el tiro).
4. Al finalizar, el resultado se muestra siempre en pantalla. Si InsForge está configurado, se sincroniza con el servidor.

## Variables de entorno

Conexión opcional a InsForge. Sin estas variables la app usa datos de prueba (mock) y no intenta conectar Realtime.

```env
PUBLIC_INSFORGE_BASE_URL=https://tu-proyecto.us-east.insforge.app
PUBLIC_INSFORGE_ANON_KEY=<anon key>
```

Obtén la anon key con `npx @insforge/cli secrets get ANON_KEY`. Copia `.env.example` a `.env.local` y no commitees secretos.

## Realtime (opcional)

Con InsForge configurado, el cliente se suscribe a:

| Canal | Uso |
|-------|-----|
| `global:presence` | Contador de jugadores en línea |
| `global:ranking` | Actualizaciones del ranking en vivo |
| `global:activity` | Feed de goles y resultados |
| `lobby:main` | Presencia del lobby y partidas abiertas |
| `match:{matchId}` | Eventos por partida (scaffold en `/play`) |

Si `connect()` o `subscribe()` fallan, la UI sigue funcionando con los datos SSR/mock.

### Migraciones

Aplica las migraciones del backend antes de usar Realtime en producción:

```bash
npx @insforge/cli db migrations up --all
```

Incluye triggers que publican `ranking_updated`, `live_event_created`, `match_created`, `match_joined` y `match_finished`.

### Edge functions (servidor)

Las escrituras a tablas de juego van por edge functions con `INSFORGE_API_KEY` (nunca en el cliente):

- `record-match-result` — persiste resultados de partidas locales
- `join-queue` / `leave-queue` — cola de matchmaking (base)

Despliega con `npx @insforge/cli functions deploy <slug> --file functions/<slug>.ts` y configura secretos con el CLI.

## Build

```bash
pnpm build
pnpm preview
```
