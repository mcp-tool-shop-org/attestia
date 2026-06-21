<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/Attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://codecov.io/gh/mcp-tool-shop-org/Attestia"><img src="https://codecov.io/gh/mcp-tool-shop-org/Attestia/graph/badge.svg" alt="codecov"></a>
  <a href="https://mcp-tool-shop-org.github.io/attestia/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Infraestrutura de verdade financeira para o mundo descentralizado.</strong></p>

---

## Missão

Acreditamos que o dinheiro — onde quer que esteja, como quer que se mova — merece o mesmo rigor dos sistemas que o criaram. Os contratos inteligentes são executados. As blockchains registram. Mas ninguém *atesta*.

Attestia é a camada ausente: governança estrutural, contabilidade determinística e intenção aprovada por humanos — unificada em diferentes cadeias, organizações e indivíduos.

Não movimentamos seu dinheiro. Provamos o que aconteceu, restringimos o que pode acontecer e tornamos o registro financeiro inviolável.

### O Que Defendemos

- **Verdade acima da velocidade.** Cada evento financeiro é apenas de adição, reproduzível e conciliável. Se não puder ser comprovado, não aconteceu.
- **Humanos aprovam; máquinas verificam.** A IA aconselha, os contratos inteligentes são executados, mas nada se move sem autorização humana explícita. Nunca.
- **Governança estrutural, não governança política.** Não votamos sobre o que é válido. Definimos invariantes que se mantêm incondicionalmente — a identidade é explícita, a linhagem é ininterrupta, a ordem é determinística.
- **A intenção não é execução.** Declarar o que você quer e fazê-lo são atos separados com portões separados. A lacuna entre eles é onde reside a confiança.
- **As cadeias são testemunhas, não autoridades.** XRPL atesta. Ethereum liquida. Mas a autoridade emana de regras estruturais, não do consenso de qualquer cadeia.
- **Infraestrutura básica vence.** O mundo não precisa de outro protocolo DeFi. Ele precisa da camada de contabilidade subjacente — o sistema financeiro que torna tudo confiável.

---

## Arquitetura

Attestia é três sistemas, uma verdade:

```
┌─────────────────────────────────────────────────────────┐
│                      ATTESTIA                           │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Personal   │  │     Org      │  │              │  │
│  │    Vault     │  │   Treasury   │  │   Registrum  │  │
│  │              │  │              │  │              │  │
│  │  Observe.    │  │  Distribute. │  │  Govern.     │  │
│  │  Budget.     │  │  Account.    │  │  Attest.     │  │
│  │  Allocate.   │  │  Reconcile.  │  │  Constrain.  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  │
│         │                 │                 │           │
│         └────────────┬────┘                 │           │
│                      │                      │           │
│              ┌───────┴───────┐              │           │
│              │  Cross-System │◀─────────────┘           │
│              │ Reconciliation│                           │
│              └───────┬───────┘                           │
│                      │                                   │
│              ┌───────┴───────┐                           │
│              │ XRPL Witness  │                           │
│              │  (attestation)│                           │
│              └───────────────┘                           │
└─────────────────────────────────────────────────────────┘
```

| Sistema | Função | Origem |
|--------|------|--------|
| **Personal Vault** | Observação de portfólio multi-cadeia, orçamento em envelope, declaração de intenção | Evoluiu do NextLedger |
| **Org Treasury** | Folha de pagamento determinística, distribuições DAO, financiamento de duplo estágio, livro razão de dupla entrada | Evoluiu do Payroll Engine |
| **Registrum** | Registrador estrutural — 11 invariantes, validação de dupla testemunha, atestação XRPL | Inalterado — camada constitucional |

---

## Experimente em 2 minutos

A maneira mais rápida de entender Attestia é observar um pagamento percorrer todo o processo. A demonstração interativa executa o pipeline completo **Intenção → Aprovar → Executar → Verificar → Atestar → Prova** de ponta a ponta — cada etapa calculada em tempo real com os pacotes de domínio reais (correspondência, hash, atestação no estilo XRPL, prova Merkle), não uma simulação.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Você verá um único pagamento de folha de pagamento se tornar uma prova criptográfica verificável independentemente, passo a passo. Adicione `--fast` para ignorar o ritmo e executar instantaneamente: `pnpm demo --fast` (`pnpm demo --help` lista todas as opções).

---

## Padrão Principal

Cada interação segue um fluxo:

```
Intent → Approve → Execute → Verify
```

1. **Intenção** — Um usuário ou sistema declara o resultado desejado
2. **Aprovar** — Registrum valida estruturalmente; um humano assina explicitamente
3. **Executar** — A transação na cadeia é enviada
4. **Verificar** — A reconciliação confirma; XRPL atesta o registro

Nenhuma etapa é opcional. Nenhuma etapa é automatizada.

---

## Princípios

| Princípio | Implementação |
|-----------|---------------|
| Registros apenas de adição | Sem ATUALIZAR, sem EXCLUIR — apenas novas entradas |
| Falha segura | Discordância interrompe o sistema, nunca se cura silenciosamente |
| Reprodução determinística | Os mesmos eventos produzem o mesmo estado, sempre |
| Apenas IA consultiva | A IA pode analisar, alertar, sugerir — nunca aprovar, assinar ou executar |
| Observação multi-cadeia | Ethereum, XRPL, Solana, L2s — camada de leitura agnóstica à cadeia |
| Identidade estrutural | Explícita, imutável, única — não biométrica, mas constitucional |

---

## Status

14 pacotes, 2.564 testes, 95% de cobertura, tudo verde. Construindo em público.

| Pacote | Testes | Propósito |
|---------|-------|---------|
| `@attestia/types` | 75 | Tipos de domínio compartilhados (zero dependências) |
| `@attestia/registrum` | 368 | Governança constitucional — 11 invariantes, dupla testemunha |
| `@attestia/ledger` | 156 | Mecanismo de dupla entrada apenas de adição |
| `@attestia/chain-observer` | 295 | Observação multi-cadeia somente leitura (EVM + XRPL + Solana + L2s) |
| `@attestia/vault` | 91 | Cofre pessoal — portfólios, orçamentos, intenções |
| `@attestia/treasury` | 109 | Tesouraria da organização — folha de pagamento, distribuições, portões de financiamento |
| `@attestia/reconciler` | 98 | Correspondência cruzada 3D + atestação Registrum |
| `@attestia/witness` | 295 | Atestação na cadeia XRPL, governança multi-assinatura, repetição |
| `@attestia/verify` | 273 | Verificação de reprodução, evidência de conformidade, aplicação de SLA |
| `@attestia/event-store` | 253 | Persistência de eventos apenas de adição, JSONL, cadeia de hash, 34 tipos de evento |
| `@attestia/proof` | 94 | Árvores Merkle (RFC 6962), provas de inclusão, empacotamento de prova de atestação |
| `@attestia/sdk` | 115 | SDK de cliente HTTP tipado para consumidores externos |
| `@attestia/node` | 342 | API REST Hono — persistência durável, autenticação, multi-locatário, tesouraria/cofre/governança, OpenAPI |
| `@attestia/demo` | — | Demonstração interativa da CLI — percorra todo o pipeline Attestia (privado, sem testes) |

### Desenvolvimento

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Testes de integração XRPL

Um nó `rippled` independente é executado no Docker para testes de integração na cadeia determinísticos — nenhuma dependência de testnet, nenhum faucet, fechamento da razão sub-segundo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentação

| Documento | Propósito |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Visão geral executiva e referência completa do pacote |
| [ROADMAP.md](ROADMAP.md) | Roteiro do projeto fase a fase |
| [DESIGN.md](DESIGN.md) | Decisões de arquitetura |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gráfico de pacotes, fluxos de dados, modelo de segurança |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pilhas de 5 camadas, padrões de implantação, limites de confiança |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integração de API com exemplos curl + uso do SDK |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guia passo a passo para a auditoria |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Análise STRIDE por componente |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mapeamento: ameaça → controle → arquivo → teste |
| [SECURITY.md](SECURITY.md) | Política de divulgação responsável |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista de verificação para preparação da implementação |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Parâmetros de referência registrados |

---

## Âmbito de segurança e dados

- **Dados acessados:** Lê e grava entradas do livro razão financeiro, registros de atestado e provas criptográficas. Conecta-se a nós da blockchain (XRPL) quando o módulo de testemunho está ativo.
- **Dados NÃO acessados:** Sem telemetria. Sem armazenamento de credenciais de usuário. Sem análise de terceiros.
- **Permissões necessárias:** Acesso de leitura/gravação aos diretórios de dados locais. Acesso à rede apenas para atestado da blockchain. Consulte [THREAT_MODEL.md](THREAT_MODEL.md) para a análise completa do STRIDE.

## Quadro de avaliação

| Barreira | Status |
|------|--------|
| A. Linha de base de segurança | APROVADO |
| B. Tratamento de erros | APROVADO |
| C. Documentação do operador | APROVADO |
| D. Boas práticas de envio | APROVADO |
| E. Identidade | APROVADO |

## Licença

[MIT](LICENSE)

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
