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

<p align="center"><strong>Infraestrutura de veracidade financeira para o mundo descentralizado.</strong></p>

---

## Missão

Acreditamos que o dinheiro — onde quer que ele exista, como quer que se mova — merece o mesmo rigor dos sistemas que o criaram. Contratos inteligentes executam. Blockchains registram. Mas ninguém *atesta*.

Attestia é a camada que está faltando: governança estrutural, contabilidade determinística e intenção aprovada por humanos — unificada em todas as cadeias, organizações e indivíduos.

Nós não movemos o seu dinheiro. Nós provamos o que aconteceu, restringimos o que pode acontecer e tornamos o registro financeiro inviolável.

### O que Defendemos

- **Veracidade acima da velocidade.** Cada evento financeiro é apenas para adicionar informações, reproduzível e reconciliável. Se não puder ser provado, não aconteceu.
- **Humanos aprovam; máquinas verificam.** A IA oferece conselhos, os contratos inteligentes executam, mas nada se move sem autorização humana explícita. Sempre.
- **Governança estrutural, não governança política.** Nós não votamos no que é válido. Nós definimos invariantes que se mantêm incondicionalmente — a identidade é explícita, a linhagem é ininterrupta, a ordem é determinística.
- **A intenção não é a execução.** Declarar o que você quer e fazer isso são atos separados, com portais separados. A lacuna entre eles é onde a confiança reside.
- **As cadeias são testemunhas, não autoridades.** XRPL atesta. Ethereum liquida. Mas a autoridade emana de regras estruturais, não do consenso de nenhuma cadeia.
- **A infraestrutura confiável é a que vence.** O mundo não precisa de mais um protocolo DeFi. Ele precisa da camada de contabilidade por baixo — a infraestrutura financeira que torna tudo o mais confiável.

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
| **Personal Vault** | Observação de portfólio multi-cadeia, orçamento de envelopes, declaração de intenção | Evoluído do NextLedger |
| **Org Treasury** | Folha de pagamento determinística, distribuições de DAO, financiamento de dupla porta, livro-razão de dupla entrada | Evoluído do Payroll Engine |
| **Registrum** | Registrador estrutural — 11 invariantes, validação de dupla testemunha, atestado XRPL | Inalterado — camada constitucional |

---

## Experimente em 2 minutos

A maneira mais rápida de entender o Attestia é assistir a um único pagamento fluir por completo. A demonstração interativa executa todo o pipeline de **Intenção → Aprovação → Execução → Verificação → Atestado → Prova** de ponta a ponta — cada etapa calculada em tempo real contra os pacotes de domínio reais (correspondência, hash, atestado no estilo XRPL, prova Merkle), e não uma simulação.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Você verá um único pagamento de folha de pagamento se tornar uma prova criptográfica independente e verificável, passo a passo. Adicione `--fast` para pular o ritmo e executar instantaneamente: `pnpm demo --fast` (`pnpm demo --help` lista todas as opções).

---

## Padrão Central

Cada interação segue um fluxo:

```
Intent → Approve → Execute → Verify
```

1. **Intenção** — Um usuário ou sistema declara um resultado desejado
2. **Aprovação** — O Registrum valida estruturalmente; um humano assina explicitamente
3. **Execução** — A transação na cadeia é enviada
4. **Verificação** — A reconciliação confirma; o XRPL atesta o registro

Nenhuma etapa é opcional. Nenhuma etapa é automatizada.

---

## Princípios

| Princípio | Implementação |
|-----------|---------------|
| Registros apenas para adicionar informações | Sem UPDATE, sem DELETE — apenas novas entradas |
| Falha segura | O desacordo interrompe o sistema, nunca se recupera silenciosamente |
| Reprodução determinística | Os mesmos eventos produzem o mesmo estado, sempre |
| IA apenas consultiva | A IA pode analisar, alertar, sugerir — nunca aprovar, assinar ou executar |
| Observação multi-cadeia | Ethereum, XRPL, Solana, L2s — camada de leitura independente da cadeia |
| Identidade estrutural | Explícito, imutável, único — não biométrico, mas constitucional. |

---

## Status

14 pacotes, 2.220 testes, 96,80% de cobertura, tudo em verde. Construção em ambiente público.

| Pacote | Testes | Propósito |
|---------|-------|---------|
| `@attestia/types` | 72 | Tipos de domínio compartilhados (sem dependências). |
| `@attestia/registrum` | 341 | Governança constitucional — 11 invariantes, dupla validação. |
| `@attestia/ledger` | 154 | Motor de registro único e imutável. |
| `@attestia/chain-observer` | 278 | Observação somente leitura em múltiplas cadeias (EVM + XRPL + Solana + L2s). |
| `@attestia/vault` | 75 | Cofre pessoal — portfólios, orçamentos, intenções. |
| `@attestia/treasury` | 92 | Tesouraria da organização — folha de pagamento, distribuições, mecanismos de financiamento. |
| `@attestia/reconciler` | 81 | Correspondência 3D entre sistemas + atestado do Registrum. |
| `@attestia/witness` | 278 | Atestado na cadeia XRPL, governança multi-assinatura, repetição. |
| `@attestia/verify` | 242 | Verificação de repetição, evidência de conformidade, aplicação de SLAs. |
| `@attestia/event-store` | 226 | Persistência de eventos somente com anexos, JSONL, cadeia de hash, 34 tipos de eventos. |
| `@attestia/proof` | 75 | Árvores de Merkle, provas de inclusão, empacotamento de provas de atestado. |
| `@attestia/sdk` | 79 | SDK de cliente HTTP tipado para consumidores externos. |
| `@attestia/node` | 227 | API REST Hono — 34 endpoints, autenticação, multi-tenência, API pública, conformidade. |
| `@attestia/demo` | — | Demonstração interativa via CLI — percorra todo o pipeline da Attestia (privado, sem testes). |

### Desenvolvimento

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,220)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Testes de integração com XRPL

Um nó `rippled` independente é executado no Docker para testes de integração determinísticos na cadeia, sem dependência de testnet, sem faucet, com fechamento do ledger em menos de um segundo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentação

| Documento | Propósito |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Visão geral executiva e referência completa do pacote. |
| [ROADMAP.md](ROADMAP.md) | Roteiro do projeto fase a fase. |
| [DESIGN.md](DESIGN.md) | Decisões de arquitetura. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gráfico do pacote, fluxos de dados, modelo de segurança. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Arquitetura de 5 camadas, padrões de implantação, limites de confiança. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integração de API com exemplos em curl + uso do SDK. |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guia passo a passo para auditores. |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Análise STRIDE por componente. |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mapeamento de ameaças → controles → arquivos → testes. |
| [SECURITY.md](SECURITY.md) | Política de divulgação responsável. |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista de verificação de preparação para adoção. |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Resultados de testes de desempenho registrados. |

---

## Escopo de segurança e dados

- **Dados acessados:** Leitura e escrita de entradas do livro-razão financeiro, registros de atestado e provas criptográficas. Conecta-se a nós de blockchain (XRPL) quando o módulo de validação está ativo.
- **Dados NÃO acessados:** Sem telemetria. Sem armazenamento de credenciais de usuário. Sem análises de terceiros.
- **Permissões necessárias:** Acesso de leitura/escrita a diretórios de dados locais. Acesso à rede apenas para atestado de blockchain. Consulte [THREAT_MODEL.md](THREAT_MODEL.md) para a análise STRIDE completa.

## Painel de avaliação

| Critério | Status |
|------|--------|
| Base de segurança | APROVADO |
| B. Tratamento de erros | APROVADO |
| C. Documentação para operadores | APROVADO |
| D. Boas práticas de implantação | APROVADO |
| E. Identidade | APROVADO |

## Licença

[MIT](LICENSE)

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a
