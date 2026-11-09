import { expect, it } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { createRequire } from "module";
import { parseDocxDocument } from "./structuredParser";

it("retains Russian text and article numbers when importing a real DOCX", async () => {
  const require = createRequire(import.meta.url);
  const JSZip = createRequire(require.resolve("mammoth"))("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>1 Трубы SANEXT</w:t></w:r></w:p><w:p><w:r><w:t>Артикул: 5905. Труба SANEXT. Температура: 0 °C.</w:t></w:r></w:p></w:body></w:document>');
  const file = path.join(os.tmpdir(), `sanext-security-${crypto.randomUUID()}.docx`);
  try {
    fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
    const parsed = await parseDocxDocument(file);
    const text = parsed.elements.map(element => element.content).join("\n");
    expect(text).toContain("Артикул: 5905");
    expect(text).toContain("Труба SANEXT");
    expect(text).toContain("0 °C");
  } finally { fs.rmSync(file, { force: true }); }
});
