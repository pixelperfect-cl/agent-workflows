// Captura de pantalla de una URL pública y la reporta al callback del hub (F3).
// Lo corre el workflow capture.yml (dispatchado por el hub antes/después del
// deploy). Envía la imagen en base64 al endpoint /api/agent/callback con el
// evento "screenshot"; el hub la guarda como adjunto INTERNA del ticket.
import puppeteer from "puppeteer";

const {
  TARGET_URL,
  PHASE,
  TICKET_ID,
  DISPATCH_ID,
  CALLBACK_URL,
  CALLBACK_SECRET,
  SELECTOR,
} = process.env;

// Cierra popups/modales/banners de cookies best-effort ANTES de la foto: sin
// esto el screenshot sale con el overlay de bienvenida/consentimiento tapando el
// sitio. Clic sobre botones de descarte (por texto es/en) priorizando los que
// viven dentro de un overlay, luego Escape. NUNCA lanza (una captura no debe
// fallar por esto). Hasta 2 pasadas (cookie banner + modal suelen convivir).
async function dismissOverlays(page) {
  const DISMISS = [
    "entendido", "entiendo", "lo entiendo", "acepto", "aceptar",
    "aceptar todo", "aceptar todas", "aceptar y continuar", "aceptar y cerrar",
    "de acuerdo", "estoy de acuerdo", "continuar", "cerrar", "ok", "vale",
    "got it", "i understand", "understood", "accept", "accept all",
    "agree", "i agree", "dismiss", "close", "no gracias", "rechazar",
  ];
  for (let pass = 0; pass < 2; pass++) {
    let hit = null;
    try {
      hit = await page.evaluate((DISMISS) => {
        const norm = (s) =>
          (s || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .trim()
            .replace(/\s+/g, " ");
        const matches = (t, d) =>
          t === d ||
          t.startsWith(d + " ") ||
          t.endsWith(" " + d) ||
          t.includes(" " + d + " ");
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const st = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            st.visibility !== "hidden" &&
            st.display !== "none" &&
            st.opacity !== "0"
          );
        };
        const inOverlay = (el) =>
          !!el.closest(
            "[role=dialog],[aria-modal=true],.modal,[class*=modal i],[class*=popup i],[class*=cookie i],[class*=consent i],[class*=overlay i]",
          );
        const cands = Array.from(
          document.querySelectorAll(
            "button,[role=button],a,input[type=button],input[type=submit]",
          ),
        )
          .filter(visible)
          .map((el) => ({
            el,
            t: norm(el.innerText || el.textContent || el.value),
          }))
          .filter(
            ({ t }) => t && t.length <= 40 && DISMISS.some((d) => matches(t, d)),
          );
        // Los que están dentro de un overlay primero (menos riesgo de clic errado).
        cands.sort((a, b) => Number(inOverlay(b.el)) - Number(inOverlay(a.el)));
        if (cands[0]) {
          cands[0].el.click();
          return cands[0].t;
        }
        return null;
      }, DISMISS);
    } catch {
      // Ignorar: best-effort.
    }
    try {
      await page.keyboard.press("Escape");
    } catch {
      // Ignorar.
    }
    // Respiro para la animación de cierre del overlay.
    await new Promise((r) => setTimeout(r, 700));
    if (!hit) break; // sin overlay que descartar: no seguir buscando.
    console.log(`Overlay descartado: "${hit}".`);
  }
}

// Con SELECTOR y un elemento visible que lo cumple: scrollIntoView y captura de
// su caja + 24 px de margen (clip dentro de la página). Sin selector, o si el
// elemento no existe / no es visible / el selector es inválido: la primera
// pantalla, como siempre.
const MARGEN = 24;
async function tomarCaptura(page) {
  const sel = (SELECTOR || "").trim();
  if (sel) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
        await new Promise((r) => setTimeout(r, 600));
        const box = await el.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const st = getComputedStyle(e);
          if (r.width <= 0 || r.height <= 0 || st.visibility === "hidden" || st.display === "none") return null;
          return {
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            width: r.width,
            height: r.height,
            pw: document.documentElement.scrollWidth,
            ph: document.documentElement.scrollHeight,
          };
        });
        if (box) {
          const x = Math.max(0, box.x - MARGEN);
          const y = Math.max(0, box.y - MARGEN);
          const w = Math.min(box.pw, box.x + box.width + MARGEN) - x;
          const h = Math.min(box.ph, box.y + box.height + MARGEN) - y;
          if (w > 0 && h > 0) {
            console.log(`Captura encuadrada en "${sel}".`);
            return await page.screenshot({
              type: "png",
              clip: { x, y, width: w, height: h },
              captureBeyondViewport: true,
            });
          }
        }
      }
      console.log(`Selector "${sel}" sin elemento visible: primera pantalla.`);
    } catch (err) {
      console.log(`Selector "${sel}" falló (${err.message}): primera pantalla.`);
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  }
  return await page.screenshot({ type: "png", fullPage: false });
}

async function main() {
  if (!TARGET_URL || !CALLBACK_URL || !CALLBACK_SECRET) {
    throw new Error("Faltan variables de entorno (URL / callback / secret)");
  }

  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(TARGET_URL, { waitUntil: "networkidle2", timeout: 45000 });
    // Respiro para fuentes/animaciones antes de la foto.
    await new Promise((r) => setTimeout(r, 1500));
    // Cerrar popups/cookies que taparían el sitio en la captura.
    await dismissOverlays(page);
    const buf = await tomarCaptura(page);
    const imageBase64 = Buffer.from(buf).toString("base64");

    const res = await fetch(CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CALLBACK_SECRET}`,
      },
      body: JSON.stringify({
        event: "screenshot",
        ticketId: TICKET_ID,
        dispatchId: DISPATCH_ID,
        phase: PHASE,
        imageBase64,
        contentType: "image/png",
        name: `Captura ${PHASE === "before" ? "antes" : "después"} del deploy`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`El callback respondió ${res.status}: ${body}`);
    }
    console.log(`Captura ${PHASE} enviada (${res.status}).`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
