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
} = process.env;

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
    const buf = await page.screenshot({ type: "png", fullPage: false });
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
