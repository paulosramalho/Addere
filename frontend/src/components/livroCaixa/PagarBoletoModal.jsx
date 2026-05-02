import React, { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";

/* ─── Boleto parsing ────────────────────────────────────────────────────────── */

/**
 * Converte barcode (44 dígitos) ou linha digitável (47/48 dígitos sem pontuação)
 * para um objeto { valor, vencimento } ou null.
 */
function parseBoleto(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 44) return parseBarcodeCobranca(digits);
  if (digits.length === 47) return parseLinhaDigitavelBanco(digits);
  if (digits.length === 48) return parseLinhaDigitavelConcessionaria(digits);
  return null;
}

/**
 * Calcula a data de vencimento a partir do fator FEBRABAN.
 * Lida com o reinício do fator em 2022-05-28 (fator 9999 → 1000 novamente).
 * Retorna null se a data não puder ser determinada com confiança (muito no passado).
 */
function calcularVencimentoFator(fator) {
  if (!fator || fator <= 0) return null;
  const BASE = new Date("1997-10-07T12:00:00Z");
  const hoje = new Date();
  // Aceitamos datas até 90 dias atrás (boleto vencido recentemente) ou no futuro
  const minAceitavel = new Date(hoje);
  minAceitavel.setDate(minAceitavel.getDate() - 90);

  // 1º ciclo
  const data1 = new Date(BASE);
  data1.setUTCDate(data1.getUTCDate() + (fator - 1000));
  if (data1 >= minAceitavel) return data1.toISOString().slice(0, 10);

  // 2º ciclo (reinício após fator 9999 = 2022-05-28)
  const data2 = new Date(data1);
  data2.setUTCDate(data2.getUTCDate() + 9000);
  if (data2 >= minAceitavel) return data2.toISOString().slice(0, 10);

  // Ambos no passado distante — data não identificável pelo fator
  return null;
}

function parseBarcodeCobranca(bar) {
  // Estrutura do código de barras (44 dígitos):
  // 0-2: banco, 3: moeda, 4: DV geral, 5-8: fator vencimento, 9-18: valor (10 dígitos), 19-43: campo livre
  const fatorStr = bar.substring(5, 9);
  const valorStr = bar.substring(9, 19);
  const fator = parseInt(fatorStr, 10);
  const valorCentavos = parseInt(valorStr, 10);
  return { valorCentavos, vencimento: calcularVencimentoFator(fator) };
}

function parseLinhaDigitavelBanco(linha) {
  // Linha digitável banco (47 dígitos sem formatação):
  // 0-9: campo1, 10-20: campo2, 21-31: campo3, 32: DV geral, 33-36: fator, 37-46: valor
  const fatorStr = linha.substring(33, 37);
  const valorStr = linha.substring(37, 47);
  const fator = parseInt(fatorStr, 10);
  const valorCentavos = parseInt(valorStr, 10);
  return { valorCentavos, vencimento: calcularVencimentoFator(fator) };
}

function parseLinhaDigitavelConcessionaria(linha) {
  // Linha digitável concessionária (48 dígitos): sem data de vencimento padronizada
  const valorStr = linha.substring(4, 14);
  const valorCentavos = parseInt(valorStr, 10);
  return { valorCentavos, vencimento: null };
}

/** Formata centavos → "R$ 1.234,56" */
function fmtBRL(cents) {
  if (!cents && cents !== 0) return "";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Formata ISO date → "DD/MM/YYYY" */
function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** ISO → input[type=date] value */
function isoToInput(iso) {
  return iso || "";
}

/**
 * Mapeamento de palavras-chave do intermediário → palavras-chave do nome da conta.
 * Extensível: adicionar novas entradas conforme necessário.
 */
const BANCO_ALIASES = [
  { from: "CELCOIN", keywords: ["VRDE"] }, // CelCoin/Itaú → conta VrdeBank
  { from: "VRDE",    keywords: ["VRDE"] }, // fallback código 341 → conta VrdeBank
  { from: "INTER",   keywords: ["BANCO", "INTER"] }, // código 077 → conta Banco Inter (exige ambas as palavras)
  { from: "SICOOB",  keywords: ["SICOOB"] },
  { from: "SICREDI", keywords: ["SICREDI"] },
];

function normStr(s) {
  return String(s || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Tenta encontrar a conta cujo nome mais combina com o intermediário do boleto.
 *  @param {string} intermediario  nome do banco/intermediário extraído do boleto
 *  @param {Array}  contas         lista de contas disponíveis
 *  @param {string} es             "E" | "S" — boleto de Entrada ou Saída
 *  Regra: CELCOIN/VRDE (infra CelCoin/Itaú) mapeiam para Banco VRDE SOMENTE em Entrada.
 *         Para Saída, não preenche conta automaticamente.
 */
function findContaByBanco(intermediario, contas, es) {
  if (!intermediario || !contas?.length) return "";
  if (es === "S") return ""; // Saída: não preenche conta
  const inter = normStr(intermediario);

  // Aliases aplicáveis a este intermediário
  const aliases = BANCO_ALIASES.filter(a => inter.includes(normStr(a.from)));

  for (const conta of contas) {
    const nome = normStr(conta.nome);
    if (aliases.length > 0) {
      // Há alias: usa SOMENTE alias (todas as keywords devem constar no nome)
      for (const alias of aliases) {
        if (alias.keywords.every(k => nome.includes(k))) return String(conta.id);
      }
    } else {
      // Sem alias: match direto por palavra ≥4 chars
      const interWords = inter.split(/\s+/).filter(w => w.length >= 4);
      if (interWords.some(w => nome.includes(w))) return String(conta.id);
    }
  }
  return "";
}

/* ─── Component ─────────────────────────────────────────────────────────────── */

export default function PagarBoletoModal({ contas, competenciaAno, competenciaMes, onClose, onSaved }) {
  const [tab, setTab] = useState("digitar"); // "digitar" | "camera" | "pdf"
  const [es, setEs] = useState("S"); // "E" | "S"

  // Linha digitável digitada
  const [linhaDigitada, setLinhaDigitada] = useState("");

  // Câmera
  const videoRef = useRef(null);
  const [cameraAtiva, setCameraAtiva] = useState(false);
  const [cameraErr, setCameraErr] = useState("");
  const scannerRef = useRef(null);
  const streamRef = useRef(null);

  // PDF
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfErr, setPdfErr] = useState("");

  // Dados extraídos
  const [parsed, setParsed] = useState(null); // { valorCentavos, vencimento, ... }
  const [isComprovante, setIsComprovante] = useState(false);
  const [parseErr, setParseErr] = useState("");

  // Wizard de Entrada (ativo quando es=E)
  // wizard: null | "loading" | "cliente" | "contrato" | "modelo" | "novo_ou_av" | "done"
  const [wizard, setWizard] = useState(null);
  const [wizardContratos, setWizardContratos] = useState([]);
  const [wizardModelos, setWizardModelos] = useState([]);
  const [wizardContrato, setWizardContrato] = useState(null); // contrato selecionado
  const [wizardModelo, setWizardModelo] = useState(null);     // { id, codigo, descricao }
  const [wizardModo, setWizardModo] = useState(null);         // "contrato" | "av"
  const [wizardModeloAlt, setWizardModeloAlt] = useState(""); // id alternativo (select)
  const [wizardClienteId, setWizardClienteId] = useState(null);
  const [wizardClienteNome, setWizardClienteNome] = useState("");
  const [wizardClienteSearch, setWizardClienteSearch] = useState("");
  const [wizardClientesResultados, setWizardClientesResultados] = useState([]);
  const [wizardClienteSearching, setWizardClienteSearching] = useState(false);
  const wizardSearchTimerRef = useRef(null);

  // Formulário de lançamento
  const [historico, setHistorico] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [contaId, setContaId] = useState("");
  const [dataVenc, setDataVenc] = useState(""); // ISO YYYY-MM-DD
  const [valorMasked, setValorMasked] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  /* Limpa câmera ao fechar ou mudar de aba */
  function pararCamera() {
    if (scannerRef.current) {
      try { scannerRef.current.reset(); } catch (_) {}
      scannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraAtiva(false);
  }

  useEffect(() => {
    return () => pararCamera();
  }, []);

  useEffect(() => {
    if (tab !== "camera") pararCamera();
  }, [tab]);

  /* Quando dados são extraídos, pré-preenche formulário */
  useEffect(() => {
    if (!parsed) return;
    if (parsed.valorCentavos > 0) {
      const v = parsed.valorCentavos / 100;
      setValorMasked(v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
    if (parsed.vencimento) setDataVenc(parsed.vencimento);
  }, [parsed]);

  /* Wizard de Entrada: disparado sempre que es=E */
  async function triggerWizard(clienteId, clienteNome) {
    setWizard("loading");
    setWizardContratos([]);
    setWizardModelos([]);
    setWizardContrato(null);
    setWizardModelo(null);
    setWizardModo(null);
    setWizardModeloAlt("");
    setWizardClienteId(clienteId || null);
    setWizardClienteNome(clienteNome || "");
    setWizardClienteSearch("");
    setWizardClientesResultados([]);
    try {
      const modelosRes = await apiFetch("/modelo-distribuicao?ativo=true");
      setWizardModelos(Array.isArray(modelosRes) ? modelosRes : []);
      if (!clienteId) {
        setWizard("cliente"); // sem cliente → step de busca
        return;
      }
      const contratosRes = await apiFetch(`/contratos?clienteId=${clienteId}`);
      setWizardContratos(Array.isArray(contratosRes) ? contratosRes : []);
      setWizard(contratosRes.length > 0 ? "contrato" : "novo_ou_av");
    } catch (_) {
      setWizard(null);
    }
  }

  async function wizardSelecionarCliente(cliente) {
    setWizardClienteId(cliente.id);
    setWizardClienteNome(cliente.nomeRazaoSocial);
    setWizardClientesResultados([]);
    setWizardClienteSearch("");
    setWizard("loading");
    try {
      const contratosRes = await apiFetch(`/contratos?clienteId=${cliente.id}`);
      setWizardContratos(Array.isArray(contratosRes) ? contratosRes : []);
      setWizard(contratosRes.length > 0 ? "contrato" : "novo_ou_av");
    } catch {
      setWizard("novo_ou_av");
    }
  }

  function handleWizardClienteSearchChange(e) {
    const q = e.target.value;
    setWizardClienteSearch(q);
    if (wizardSearchTimerRef.current) clearTimeout(wizardSearchTimerRef.current);
    if (!q || q.length < 2) { setWizardClientesResultados([]); return; }
    wizardSearchTimerRef.current = setTimeout(async () => {
      setWizardClienteSearching(true);
      try {
        const res = await apiFetch(`/clients?search=${encodeURIComponent(q)}&limit=10&ativo=true`);
        const list = Array.isArray(res) ? res : (res?.data || []);
        setWizardClientesResultados(list);
      } catch {
        setWizardClientesResultados([]);
      } finally {
        setWizardClienteSearching(false);
      }
    }, 350);
  }

  function wizardConfirmarModelo(modelo) {
    setWizardModelo(modelo);
    setWizard("done");
  }

  /* ── Aba: Digitar ── */
  function handleLinhaChange(e) {
    setLinhaDigitada(e.target.value);
    setParseErr("");
    setParsed(null);
  }

  function handleParseDigitada() {
    setParseErr("");
    const result = parseBoleto(linhaDigitada);
    if (!result) {
      setParseErr("Código não reconhecido. Verifique se colou a linha digitável completa (47, 48 ou 44 dígitos).");
      return;
    }
    setParsed(result);
    if (es === "E") triggerWizard(null, null);
  }

  /* ── Aba: Câmera ── */
  async function iniciarCamera() {
    setCameraErr("");
    try {
      const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await import("@zxing/browser");
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.ITF]);

      const reader = new BrowserMultiFormatReader(hints);
      scannerRef.current = reader;

      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraAtiva(true);

      reader.decodeFromStream(stream, videoRef.current, (result, err) => {
        if (result) {
          const texto = result.getText();
          pararCamera();
          setTab("digitar");
          setLinhaDigitada(texto);
          const parsed = parseBoleto(texto);
          if (parsed) {
            setParsed(parsed);
          } else {
            setParseErr("Código de barras lido, mas não foi possível extrair dados. Código: " + texto);
          }
        }
      });
    } catch (err) {
      setCameraErr("Não foi possível acessar a câmera: " + (err.message || String(err)));
    }
  }

  /* ── Aba: PDF ── */
  async function handlePdfUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFile(file);
    setPdfErr("");
    setParsed(null);
    setPdfLoading(true);
    try {
      const fd = new FormData();
      fd.append("boleto", file);
      const result = await apiFetch("/livro-caixa/boleto/parse-pdf", {
        method: "POST",
        body: fd,
      });
      if (!result.linha && !result.valorCentavos && !result.vencimento) {
        setPdfErr("Não foi possível extrair dados do PDF.");
        return;
      }
      if (result.linha) {
        setLinhaDigitada(result.linha);
        setTab("digitar");
      }

      // Valor: preferir texto (já parseado no backend), fallback código de barras
      const p = parseBoleto(result.linha || "");
      const valorFinal = result.valorCentavos || p?.valorCentavos || 0;
      // Vencimento: SEMPRE usar o do texto (mais confiável que o fator do código)
      const vencFinal = result.vencimento || p?.vencimento || null;

      const fonte = result.fonte || "";
      setIsComprovante(fonte === "pix_comprovante");
      setParsed({
        valorCentavos: valorFinal,
        vencimento: vencFinal,
        pagador: result.pagador || null,
        cpfCnpjPagador: result.cpfCnpjPagador || null,
        beneficiario: result.beneficiario || null,
        numeroDocumento: result.numeroDocumento || null,
        intermediario: result.intermediario || null,
        esSugerido: result.esSugerido || null,
        clienteId: result.clienteId || null,
        clienteNome: result.clienteNome || null,
        clienteStatus: result.clienteStatus || null,
      });

      // Pré-preencher formulário com os dados extraídos do texto
      if (result.esSugerido) setEs(result.esSugerido);

      // Fornecedor/pagador: preferir nome do cadastro (normalizado), fallback texto do PDF
      const nomeCadastro = result.clienteNome;
      const esEfetivo    = result.esSugerido || es;
      const nomeParte    = nomeCadastro || (esEfetivo === "E" ? result.pagador : result.beneficiario);
      if (nomeParte) setFornecedor(nomeParte);

      if (result.historico) setHistorico(result.historico);
      else if (result.numeroDocumento) setHistorico(`Documento Nº ${result.numeroDocumento}`);

      if (result.intermediario) {
        const esEfetivoContam = result.esSugerido || es;
        const contaFound = findContaByBanco(result.intermediario, contas, esEfetivoContam);
        if (contaFound) setContaId(contaFound);
      }

      // Wizard de Entrada: dispara sempre que entrada
      if ((result.esSugerido || es) === "E") {
        triggerWizard(result.clienteId || null, result.clienteNome || null);
      }
    } catch (err) {
      setPdfErr("Erro ao processar PDF: " + (err.message || String(err)));
    } finally {
      setPdfLoading(false);
    }
  }

  /* ── Máscara de valor BRL ── */
  function handleValorChange(e) {
    const digits = e.target.value.replace(/\D/g, "");
    if (!digits) { setValorMasked(""); return; }
    const cents = parseInt(digits, 10);
    setValorMasked((cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }

  function centavosFromMasked(masked) {
    const digits = String(masked || "").replace(/\D/g, "");
    return parseInt(digits, 10) || 0;
  }

  function isoToBR(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }

  /* ── Salvar lançamento ── */
  async function handleSalvar() {
    setSaveErr("");
    try {
      const valorCentavos = centavosFromMasked(valorMasked);
      if (!valorCentavos) throw new Error("Informe o valor do arquivo.");
      if (!dataVenc) throw new Error("Informe a data de vencimento.");
      if (!historico.trim()) throw new Error("Informe o histórico (descrição do pagamento).");

      const dataBR = isoToBR(dataVenc);
      const contaIdNum = Number(contaId) || null;

      // Competência sempre igual ao mês/ano do vencimento
      const [anoVenc, mesVenc] = dataVenc.split("-").map(Number);

      setSaving(true);

      if (wizardModo === "av") {
        // Pagamento avulso: cria contrato 1 parcela + lançamento LC em um só endpoint
        if (!contaIdNum) throw new Error("Selecione a conta bancária para o lançamento avulso.");
        const clienteIdParaAV = wizardClienteId || parsed?.clienteId;
        if (!clienteIdParaAV) throw new Error("Selecione o cliente para o lançamento avulso.");
        await apiFetch("/pagamentos-avulsos", {
          method: "POST",
          body: {
            clienteId: clienteIdParaAV,
            contaId: contaIdNum,
            descricao: historico.trim(),
            dataRecebimento: dataBR,
            valorRecebido: String(valorCentavos), // backend interpreta dígitos como centavos
          },
        });
      } else {
        // Lançamento normal no livro caixa
        await apiFetch("/livro-caixa/lancamentos", {
          method: "POST",
          body: {
            competenciaAno: anoVenc,
            competenciaMes: mesVenc,
            dataBR,
            es,
            valorCentavos,
            clienteFornecedor: fornecedor.trim() || null,
            historico: historico.trim(),
            contaId: contaIdNum,
            confirmarAgora: isComprovante, // comprovantes entram direto como EFETIVADO
          },
        });
      }

      onSaved();
      onClose();
    } catch (err) {
      setSaveErr(err.message || String(err));
    } finally {
      setSaving(false);
    }
  }

  /* ── Estilos ── */
  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9000,
  };
  const box = {
    background: "#fff", borderRadius: 12, padding: "24px 28px",
    width: "min(540px, 96vw)", maxHeight: "92vh", overflowY: "auto",
    boxShadow: "0 8px 40px rgba(0,0,0,0.22)",
  };
  const tabStyle = (active) => ({
    padding: "6px 16px", cursor: "pointer", borderRadius: "6px 6px 0 0",
    border: "1px solid #cbd5e1", borderBottom: active ? "2px solid #fff" : "1px solid #cbd5e1",
    background: active ? "#fff" : "#f1f5f9", fontWeight: active ? 600 : 400,
    fontSize: 13, marginRight: 4,
  });
  const inputS = {
    width: "100%", padding: "8px 10px", border: "1px solid #cbd5e1",
    borderRadius: 7, fontSize: 14, boxSizing: "border-box",
  };
  const labelS = { fontSize: 13, fontWeight: 600, color: "#374151", display: "block", marginBottom: 4 };
  const fieldWrap = { marginBottom: 14 };
  const btnPrimary = {
    padding: "9px 22px", background: "#1e3a5f", color: "#fff",
    border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 14,
  };
  const btnSec = {
    padding: "9px 18px", background: "#f1f5f9", color: "#374151",
    border: "1px solid #cbd5e1", borderRadius: 8, cursor: "pointer", fontSize: 14,
  };

  // Competência exibida no título = mês/ano do vencimento (se preenchido), senão o contexto atual
  const compLabel = dataVenc
    ? (() => { const [y, m] = dataVenc.split("-"); return `${m}/${y}`; })()
    : `${String(competenciaMes).padStart(2, "0")}/${competenciaAno}`;

  return (
    <div style={overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={box}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 17, color: "#1e3a5f" }}>
            📄 Registrar via Arquivo — <span style={{ fontWeight: 400, fontSize: 14 }}>{compLabel}</span>
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}>×</button>
        </div>

        {/* E/S toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            onClick={() => { setEs("S"); setWizard(null); }}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 7, fontWeight: 600, fontSize: 14, cursor: "pointer",
              border: es === "S" ? "2px solid #dc2626" : "1px solid #cbd5e1",
              background: es === "S" ? "#fef2f2" : "#f8fafc",
              color: es === "S" ? "#dc2626" : "#64748b",
            }}
          >
            ↑ Saída (pagamento)
          </button>
          <button
            onClick={() => {
              setEs("E");
              if (parsed && !wizard) triggerWizard(parsed.clienteId || null, parsed.clienteNome || null);
            }}
            style={{
              flex: 1, padding: "8px 0", borderRadius: 7, fontWeight: 600, fontSize: 14, cursor: "pointer",
              border: es === "E" ? "2px solid #16a34a" : "1px solid #cbd5e1",
              background: es === "E" ? "#f0fdf4" : "#f8fafc",
              color: es === "E" ? "#16a34a" : "#64748b",
            }}
          >
            ↓ Entrada (recebimento)
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{ display: "flex", marginBottom: -1, borderBottom: "1px solid #cbd5e1" }}>
          <button style={tabStyle(tab === "digitar")} onClick={() => setTab("digitar")}>✏️ Digitar</button>
          <button style={tabStyle(tab === "camera")} onClick={() => setTab("camera")}>📷 Câmera</button>
          <button style={tabStyle(tab === "pdf")} onClick={() => setTab("pdf")}>📄 Arquivo</button>
        </div>

        <div style={{ border: "1px solid #cbd5e1", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "16px 12px", marginBottom: 16 }}>

          {/* ── Aba: Digitar ── */}
          {tab === "digitar" && (
            <div>
              <label style={labelS}>Linha digitável ou código de barras (cole aqui)</label>
              <textarea
                value={linhaDigitada}
                onChange={handleLinhaChange}
                rows={3}
                placeholder="Cole a linha digitável ou código de barras (47, 48 ou 44 dígitos)…"
                style={{ ...inputS, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
              />
              <button
                onClick={handleParseDigitada}
                disabled={!linhaDigitada.trim()}
                style={{ ...btnPrimary, marginTop: 8, opacity: linhaDigitada.trim() ? 1 : 0.5 }}
              >
                Extrair dados
              </button>
              {parseErr && <p style={{ color: "#dc2626", fontSize: 13, marginTop: 8 }}>{parseErr}</p>}
            </div>
          )}

          {/* ── Aba: Câmera ── */}
          {tab === "camera" && (
            <div style={{ textAlign: "center" }}>
              {!cameraAtiva && (
                <button onClick={iniciarCamera} style={{ ...btnPrimary, marginBottom: 12 }}>
                  📷 Iniciar câmera
                </button>
              )}
              {cameraErr && <p style={{ color: "#dc2626", fontSize: 13 }}>{cameraErr}</p>}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: "100%", borderRadius: 8, display: cameraAtiva ? "block" : "none" }}
              />
              {cameraAtiva && (
                <div>
                  <p style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
                    Aponte a câmera para o código de barras do boleto (ITF-25)
                  </p>
                  <button onClick={pararCamera} style={{ ...btnSec, marginTop: 4 }}>Parar câmera</button>
                </div>
              )}
            </div>
          )}

          {/* ── Aba: Arquivo (PDF ou imagem) ── */}
          {tab === "pdf" && (
            <div>
              <label style={labelS}>Selecione o arquivo — PDF ou imagem (JPG, PNG)</label>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handlePdfUpload}
                style={{ fontSize: 14, marginBottom: 8 }}
              />
              {pdfLoading && <p style={{ color: "#3b82f6", fontSize: 13 }}>Extraindo dados…</p>}
              {pdfErr && <p style={{ color: "#dc2626", fontSize: 13 }}>{pdfErr}</p>}
              {pdfFile && !pdfLoading && !pdfErr && !parsed && (
                <p style={{ fontSize: 13, color: "#64748b" }}>Arquivo: {pdfFile.name}</p>
              )}
            </div>
          )}
        </div>

        {/* ── Dados extraídos ── */}
        {parsed && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
            <p style={{ margin: 0, fontWeight: 600, color: "#166534", fontSize: 14 }}>✅ Dados extraídos do arquivo</p>
            <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", color: "#1e293b" }}>
              <div>Valor: <strong>{fmtBRL(parsed.valorCentavos)}</strong></div>
              <div>
                Vencimento:{" "}
                {parsed.vencimento
                  ? <strong>{fmtDate(parsed.vencimento)}</strong>
                  : <span style={{ color: "#92400e" }}>não identificado — preencha abaixo</span>
                }
              </div>
              {parsed.pagador && <div>Pagador: <strong>{parsed.pagador}</strong>{parsed.cpfCnpjPagador ? ` (${parsed.cpfCnpjPagador})` : ""}</div>}
              {parsed.beneficiario && <div>Beneficiário: <strong>{parsed.beneficiario}</strong></div>}
              {parsed.numeroDocumento && <div>Nº Documento: <strong>{parsed.numeroDocumento}</strong></div>}
              {parsed.intermediario && <div>Banco/Intermediário: <strong>{parsed.intermediario}</strong></div>}
              {parsed.clienteStatus && (
                <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                  {parsed.clienteStatus === "encontrado" && (
                    <span style={{ color: "#166534", fontWeight: 600 }}>
                      ✓ Cadastro encontrado: {parsed.clienteNome}
                    </span>
                  )}
                  {parsed.clienteStatus === "criado" && (
                    <span style={{ color: "#0369a1", fontWeight: 600 }}>
                      ✦ Cadastrado automaticamente: {parsed.clienteNome}
                    </span>
                  )}
                  {parsed.clienteStatus === "nao_identificado" && (
                    <span style={{ color: "#92400e" }}>
                      ⚠ Não foi possível identificar o cadastro — preencha o campo abaixo
                    </span>
                  )}
                </div>
              )}
            </div>
            {parsed.esSugerido && (
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#166534" }}>
                ℹ️ {parsed.esSugerido === "E" ? "Beneficiário é o escritório → definido como Entrada." : "Beneficiário é externo → definido como Saída."}
              </p>
            )}
          </div>
        )}

        {/* ── Wizard de Entrada ── */}
        {wizard && wizard !== "done" && (
          <div style={{ border: "2px solid #3b82f6", borderRadius: 10, padding: "14px 16px", marginBottom: 16, background: "#eff6ff" }}>

            {/* Loading */}
            {wizard === "loading" && (
              <p style={{ margin: 0, color: "#1d4ed8", fontSize: 14 }}>Verificando contratos do cliente…</p>
            )}

            {/* Etapa 0: buscar cliente (quando não identificado automaticamente) */}
            {wizard === "cliente" && (
              <div>
                <p style={{ margin: "0 0 10px", fontWeight: 600, color: "#1e3a5f", fontSize: 14 }}>
                  Cliente não identificado — busque e selecione:
                </p>
                <div style={{ position: "relative" }}>
                  <input
                    autoFocus
                    type="text"
                    value={wizardClienteSearch}
                    onChange={handleWizardClienteSearchChange}
                    placeholder="Digite nome ou CPF/CNPJ do cliente…"
                    style={{ ...inputS, paddingRight: wizardClienteSearching ? 32 : 10 }}
                  />
                  {wizardClienteSearching && (
                    <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#64748b" }}>⏳</span>
                  )}
                </div>
                {wizardClientesResultados.length > 0 && (
                  <div style={{ marginTop: 6, border: "1px solid #bfdbfe", borderRadius: 7, overflow: "hidden", maxHeight: 200, overflowY: "auto" }}>
                    {wizardClientesResultados.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => wizardSelecionarCliente(c)}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: "#fff", border: "none", borderBottom: "1px solid #e2e8f0", cursor: "pointer", fontSize: 13 }}
                        onMouseEnter={e => e.currentTarget.style.background = "#eff6ff"}
                        onMouseLeave={e => e.currentTarget.style.background = "#fff"}
                      >
                        <strong>{c.nomeRazaoSocial}</strong>
                        {c.cpfCnpj ? <span style={{ color: "#64748b", marginLeft: 8 }}>{c.cpfCnpj}</span> : ""}
                      </button>
                    ))}
                  </div>
                )}
                {wizardClienteSearch.length >= 2 && !wizardClienteSearching && wizardClientesResultados.length === 0 && (
                  <p style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>Nenhum cliente encontrado.</p>
                )}
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => { setWizardModo("av"); setWizard("modelo"); }}
                    style={{ ...btnSec, fontSize: 12 }}
                  >
                    Pular — definir cliente depois
                  </button>
                </div>
              </div>
            )}

            {/* Etapa 1a: tem contrato(s) ativo(s) */}
            {wizard === "contrato" && (
              <div>
                <p style={{ margin: "0 0 10px", fontWeight: 600, color: "#1e3a5f", fontSize: 14 }}>
                  Contrato(s) ativo(s) encontrado(s) para {wizardClienteNome || parsed?.clienteNome}:
                </p>
                {wizardContratos.map(c => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", border: "1px solid #bfdbfe", borderRadius: 7, padding: "8px 12px", marginBottom: 8 }}>
                    <span style={{ fontSize: 13 }}>
                      <strong>#{c.numeroContrato}</strong>
                      {c.modeloDistribuicao ? ` — Modelo ${c.modeloDistribuicao.codigo}` : ""}
                      {c.valorTotal ? ` — R$ ${Number(c.valorTotal).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : ""}
                    </span>
                    <button
                      onClick={() => { setWizardContrato(c); setWizardModo("contrato"); setWizard("modelo"); }}
                      style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12 }}
                    >
                      Sim, este
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setWizard("novo_ou_av")}
                  style={{ ...btnSec, fontSize: 13, marginTop: 4 }}
                >
                  Nenhum desses — é pagamento novo
                </button>
              </div>
            )}

            {/* Etapa 1b: sem contratos */}
            {wizard === "novo_ou_av" && (
              <div>
                <p style={{ margin: "0 0 10px", fontWeight: 600, color: "#1e3a5f", fontSize: 14 }}>
                  {wizardContratos.length === 0
                    ? `Nenhum contrato ativo encontrado para ${wizardClienteNome || parsed?.clienteNome || "o cliente"}.`
                    : "Como prosseguir?"}
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { setWizardModo("av"); setWizard("modelo"); }}
                    style={{ ...btnPrimary, flex: 1, fontSize: 13 }}
                  >
                    Lançar como Avulso
                  </button>
                  <button
                    onClick={() => { onClose(); window.location.href = "/contratos"; }}
                    style={{ ...btnSec, flex: 1, fontSize: 13 }}
                  >
                    Criar novo contrato
                  </button>
                </div>
              </div>
            )}

            {/* Etapa 2: confirmar modelo de distribuição */}
            {wizard === "modelo" && (
              <div>
                <p style={{ margin: "0 0 10px", fontWeight: 600, color: "#1e3a5f", fontSize: 14 }}>
                  {wizardModo === "contrato"
                    ? `Modelo de distribuição do contrato #${wizardContrato?.numeroContrato}:`
                    : "Selecione o modelo de distribuição para o avulso:"}
                </p>

                {/* Modelo atual do contrato (se houver) */}
                {wizardModo === "contrato" && wizardContrato?.modeloDistribuicao && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", border: "1px solid #bfdbfe", borderRadius: 7, padding: "8px 12px", marginBottom: 10 }}>
                    <span style={{ fontSize: 13 }}>
                      <strong>{wizardContrato.modeloDistribuicao.codigo}</strong>
                      {wizardContrato.modeloDistribuicao.descricao ? ` — ${wizardContrato.modeloDistribuicao.descricao}` : ""}
                    </span>
                    <button
                      onClick={() => wizardConfirmarModelo(wizardContrato.modeloDistribuicao)}
                      style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12, background: "#16a34a" }}
                    >
                      Confirmar
                    </button>
                  </div>
                )}

                <label style={{ ...labelS, marginTop: 6 }}>
                  {wizardModo === "contrato" ? "Ou usar outro modelo:" : "Modelo:"}
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <select
                    value={wizardModeloAlt}
                    onChange={e => setWizardModeloAlt(e.target.value)}
                    style={{ ...inputS, flex: 1 }}
                  >
                    <option value="">— selecione —</option>
                    {wizardModelos.map(m => (
                      <option key={m.id} value={m.id}>{m.codigo}{m.descricao ? ` — ${m.descricao}` : ""}</option>
                    ))}
                  </select>
                  <button
                    disabled={!wizardModeloAlt}
                    onClick={() => {
                      const m = wizardModelos.find(x => String(x.id) === String(wizardModeloAlt));
                      wizardConfirmarModelo(m || null);
                    }}
                    style={{ ...btnPrimary, opacity: wizardModeloAlt ? 1 : 0.4, whiteSpace: "nowrap" }}
                  >
                    Usar este
                  </button>
                </div>

                {wizardModo === "contrato" && !wizardContrato?.modeloDistribuicao && (
                  <p style={{ fontSize: 12, color: "#92400e", marginTop: 6 }}>
                    Contrato sem modelo definido — selecione um acima.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Wizard concluído: resumo */}
        {wizard === "done" && (
          <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 13, color: "#166534" }}>
            {wizardModo === "contrato" && (
              <>
                Contrato <strong>#{wizardContrato?.numeroContrato}</strong>
                {wizardModelo ? ` — Modelo ${wizardModelo.codigo}` : ""}
                {" "}<button onClick={() => setWizard("contrato")} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>alterar</button>
              </>
            )}
            {wizardModo === "av" && (
              <>
                Lançamento <strong>Avulso</strong>
                {(wizardClienteNome || parsed?.clienteNome) ? ` — ${wizardClienteNome || parsed?.clienteNome}` : ""}
                {wizardModelo ? ` — Modelo ${wizardModelo.codigo}` : ""}
                {" "}<button onClick={() => setWizard("novo_ou_av")} style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 12, textDecoration: "underline" }}>alterar</button>
              </>
            )}
          </div>
        )}

        {/* ── Formulário de lançamento ── */}
        <div style={fieldWrap}>
          <label style={labelS}>Histórico / Descrição <span style={{ color: "#dc2626" }}>*</span></label>
          <input
            value={historico}
            onChange={e => setHistorico(e.target.value)}
            placeholder="Ex: Equatorial Energia Fev/26"
            style={inputS}
          />
        </div>

        <div style={fieldWrap}>
          <label style={labelS}>{es === "S" ? "Fornecedor / Beneficiário" : "Cliente / Pagador"}</label>
          <input
            value={fornecedor}
            onChange={e => setFornecedor(e.target.value)}
            placeholder="Opcional — nome da empresa ou pessoa"
            style={inputS}
          />
        </div>

        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={labelS}>Valor (R$) <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              value={valorMasked}
              onChange={handleValorChange}
              placeholder="0,00"
              inputMode="numeric"
              style={inputS}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelS}>Data de vencimento <span style={{ color: "#dc2626" }}>*</span></label>
            <input
              type="date"
              value={isoToInput(dataVenc)}
              onChange={e => setDataVenc(e.target.value)}
              style={inputS}
            />
          </div>
        </div>

        <div style={fieldWrap}>
          <label style={labelS}>Conta bancária <span style={{ fontSize: 12, fontWeight: 400, color: "#64748b" }}>(opcional — pode definir depois)</span></label>
          <select value={contaId} onChange={e => setContaId(e.target.value)} style={inputS}>
            <option value="">— Sem conta (definir depois) —</option>
            {contas.map(c => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        <div style={{ background: isComprovante ? "#f0fdf4" : "#fffbeb", border: `1px solid ${isComprovante ? "#86efac" : "#fcd34d"}`, borderRadius: 7, padding: "8px 12px", marginBottom: 16, fontSize: 13, color: isComprovante ? "#166534" : "#92400e" }}>
          {isComprovante
            ? <>✅ Comprovante — lançamento será criado como <strong>{es === "S" ? "Saída" : "Entrada"} EFETIVADA</strong>{" "}na competência <strong>{compLabel}</strong>.</>
            : <>ℹ️ O lançamento será criado como <strong>{es === "S" ? "Saída" : "Entrada"} PREVISTA</strong>{" "}na competência <strong>{compLabel}</strong> (mês/ano do vencimento). Confirme na tabela quando {es === "S" ? "o pagamento for efetuado" : "o recebimento for confirmado"}.</>
          }
        </div>

        {saveErr && <p style={{ color: "#dc2626", fontSize: 13, marginBottom: 10 }}>{saveErr}</p>}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={btnSec}>Cancelar</button>
          <button
            onClick={handleSalvar}
            disabled={saving}
            style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? "Salvando…" : "💾 Criar lançamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
