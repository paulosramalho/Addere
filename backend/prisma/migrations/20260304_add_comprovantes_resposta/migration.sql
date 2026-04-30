-- CreateTable: ComprovanteRespostaCliente
CREATE TABLE "ComprovanteRespostaCliente" (
    "id"              SERIAL PRIMARY KEY,
    "gmailMessageId"  TEXT NOT NULL,
    "parcelaId"       INTEGER,
    "clienteId"       INTEGER,
    "remetenteEmail"  TEXT NOT NULL,
    "assunto"         TEXT,
    "corpoTexto"      TEXT,
    "recebidoEm"      TIMESTAMP(3) NOT NULL,
    "revisado"        BOOLEAN NOT NULL DEFAULT false,
    "revisadoEm"      TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComprovanteRespostaCliente_gmailMessageId_key" UNIQUE ("gmailMessageId"),
    CONSTRAINT "ComprovanteRespostaCliente_parcelaId_fkey" FOREIGN KEY ("parcelaId") REFERENCES "ParcelaContrato"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ComprovanteRespostaCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "ComprovanteRespostaCliente_revisado_idx" ON "ComprovanteRespostaCliente"("revisado");
CREATE INDEX "ComprovanteRespostaCliente_clienteId_idx" ON "ComprovanteRespostaCliente"("clienteId");

-- CreateTable: ComprovanteAnexo
CREATE TABLE "ComprovanteAnexo" (
    "id"            SERIAL PRIMARY KEY,
    "comprovanteId" INTEGER NOT NULL,
    "nomeArquivo"   TEXT NOT NULL,
    "mimeType"      TEXT NOT NULL,
    "tamanhoBytes"  INTEGER NOT NULL,
    "conteudo"      BYTEA NOT NULL,
    CONSTRAINT "ComprovanteAnexo_comprovanteId_fkey" FOREIGN KEY ("comprovanteId") REFERENCES "ComprovanteRespostaCliente"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
