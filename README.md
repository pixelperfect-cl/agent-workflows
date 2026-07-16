# agent-workflows

Workflows del agente de código de Pixel Perfect (F6 Fase B del hub).

Cuando la agencia aprueba el plan IA de un ticket en admin.pixelperfect.cl, el
hub dispara `workflow_dispatch` sobre el stub `pixelperfect-agent.yml` del repo
del cliente. Ese stub llama al workflow reutilizable de este repo
(`.github/workflows/ticket-agent.yml`), que corre Claude Code con el ticket y
el plan como prompt, abre un Pull Request y reporta el resultado al hub
(`/api/agent/callback`).

**Regla de oro:** el agente jamás hace push a la rama base ni deploya. Su único
entregable es un PR; el deploy a producción siempre pasa por humano.

## Estructura

- `.github/workflows/ticket-agent.yml`: workflow reutilizable (workflow_call).
  Toda la lógica vive acá; los repos cliente solo lo referencian.
- `templates/pixelperfect-agent.yml`: stub que se copia a cada repo cliente en
  `.github/workflows/pixelperfect-agent.yml` (el nombre es la convención que
  usa el hub; no renombrar).

## Setup de la cuenta (una sola vez)

> OJO: `pixelperfect-cl` es una CUENTA DE USUARIO de GitHub, no una
> organización. No existen "org secrets": los 2 secrets se setean POR REPO en
> el onboarding (scriptable, ver abajo). Si algún día se migra a una
> organización real, los secrets pueden centralizarse ahí.

1. Este repo → Settings → Actions → General → Access: **"Accessible from
   repositories owned by the user"** (sin esto los `uses:` de los repos
   cliente fallan).
2. Generar y guardar los valores base (una vez, quedan a mano para los
   onboardings):
   - `CLAUDE_CODE_OAUTH_TOKEN`: generado con `claude setup-token` (suscripción
     Claude de la agencia).
   - `AGENT_CALLBACK_SECRET`: el mismo valor configurado en Vercel
     (proyecto pixelperfect-hub). Generar con `openssl rand -hex 32`.
3. En el hub: guardar el PAT fine-grained (Actions: Read and write, todos los
   repos de la cuenta) en Configuración → Agente IA, y `AGENT_CALLBACK_SECRET`
   en el env de Vercel.

## Onboarding de un repo cliente (~5 minutos)

1. Copiar `templates/pixelperfect-agent.yml` a
   `.github/workflows/pixelperfect-agent.yml` en la rama default.
2. Secrets y permisos del repo (los 3 comandos):

   ```bash
   gh secret set CLAUDE_CODE_OAUTH_TOKEN -R pixelperfect-cl/<repo>
   gh secret set AGENT_CALLBACK_SECRET -R pixelperfect-cl/<repo>
   gh api -X PUT repos/pixelperfect-cl/<repo>/actions/permissions/workflow \
     -f default_workflow_permissions=write \
     -F can_approve_pull_request_reviews=true
   ```

   (El tercero habilita "Allow GitHub Actions to create and approve pull
   requests", necesario para que el agente abra el PR con `github.token`.)
3. Registrar/verificar `repoUrl` + `repoBranch` en la ficha de infraestructura
   del cliente (admin → cliente → Infraestructura).
4. Recomendado: un `CLAUDE.md` en el repo con las convenciones del proyecto.

## Probar el runner sin el hub

```bash
gh workflow run pixelperfect-agent.yml -R pixelperfect-cl/<repo> \
  -f ticket_id=11111111-2222-3333-4444-555555555555 \
  -f dispatch_id=66666666-7777-8888-9999-000000000000 \
  -f prompt="Arregla el typo del footer (dice 'contatco')." \
  -f callback_url=https://webhook.site/<id>
```

Debe abrir un PR y mandar dos POST al callback: `started` (con runUrl) y
`completed` (con status ok/sin_cambios/error y el PR si existe).
