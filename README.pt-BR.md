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

<p align="center"><strong>Prova de que um evento, uma transação ou uma transição de estado ocorreu, vinculada a uma cadeia.</strong></p>

---

## Missão

Acreditamos que o dinheiro — onde quer que esteja, como quer que se mova — merece o mesmo rigor dos sistemas que o criaram. Os contratos inteligentes são executados. As blockchains registram. Mas ninguém *atesta*.

A Attestia oferece essa camada para o dinheiro: governança estrutural, contabilidade determinística e intenção aprovada por humanos, em várias cadeias, organizações e indivíduos.

Não movimentamos seu dinheiro. Provamos o que aconteceu, restringimos o que pode acontecer e tornamos o registro financeiro inviolável.

### O que defendemos

- **Verdade acima da velocidade.** Cada evento financeiro é apenas de adição, reproduzível e conciliável. Se não puder ser comprovado, não aconteceu.
- **Humanos aprovam; máquinas verificam.** A IA aconselha, os contratos inteligentes são executados, mas nada se move sem autorização humana explícita. Nunca.
- **Governança estrutural, não governança política.** Não votamos sobre o que é válido. Definimos invariantes que se mantêm incondicionalmente — a identidade é explícita, a linhagem é ininterrupta, a ordem é determinística.
- **A intenção não é a execução.** Declarar o que você quer e fazê-lo são atos separados, com portões separados. A lacuna entre eles é onde a confiança reside.
- **As cadeias são testemunhas, não autoridades.** A XRPL atesta. A Ethereum liquida. Mas a autoridade emana de regras estruturais, não do consenso de qualquer cadeia.
- **Infraestrutura simples vence.** O mundo não precisa de mais um protocolo DeFi. Ele precisa da camada de contabilidade subjacente — a infraestrutura financeira que torna tudo o mais confiável.

## Lugar no sistema

Attestia, Cognate e RepoMesh são três produtos.

A **Attestia** prova que um evento, uma transação ou uma transição de estado ocorreu e vincula essa prova a uma cadeia. O domínio que ela oferece é a verdade financeira: cofre pessoal, tesouraria organizacional e registrum. Seus primitivos de prova são um armazenamento de eventos apenas de adição e provas de Merkle.

A **Cognate** é o domínio de governança de IA nesses primitivos: linhagem do modelo, decisões de política, capacidades do agente e integridade do prompt e da saída. Ela não mantém um segundo armazenamento de eventos.

A **RepoMesh** é a rede de lançamento: eventos assinados, manifestos de nós e um relógio de confiança ancorado na XRPL. Ela mantém seu próprio livro-razão RFC 6962. Não usa a árvore de Merkle da Attestia.

A Cognate chama a Attestia quando precisa de uma prova e a RepoMesh quando precisa que um lançamento seja verificado.

---

## Arquitetura

A Attestia é três sistemas, uma verdade:

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
| **Personal Vault** | Observação de portfólio multi-cadeia, orçamento de envelope, declaração de intenção | Evoluiu da NextLedger |
| **Org Treasury** | Folha de pagamento determinística, distribuições DAO, financiamento de duplo portão, livro-razão de dupla entrada | Evoluiu do Payroll Engine |
| **Registrum** | Registrador estrutural — 11 invariantes, validação de dupla testemunha, atestação XRPL | Inalterado — camada constitucional |

---

## Experimente em 2 minutos

A maneira mais rápida de entender a Attestia é observar um pagamento percorrer todo o processo. A demonstração interativa executa o pipeline completo de **Intenção → Aprovação → Execução → Verificação → Atestação → Prova** de ponta a ponta — cada etapa é calculada em tempo real em relação aos pacotes de domínio reais (correspondência, hash, atestação no estilo XRPL, prova de Merkle), não uma simulação.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Você verá um único pagamento de folha de pagamento se tornar uma prova criptográfica verificável de forma independente, passo a passo. Adicione `--fast` para pular o ritmo e executar instantaneamente: `pnpm demo --fast` (`pnpm demo --help` lista todas as flags).

---

## Padrão central

Cada interação segue um fluxo:

```
Intent → Approve → Execute → Verify
```

1. **Intenção** — Um usuário ou sistema declara um resultado desejado
2. **Aprovação** — O Registrum valida estruturalmente; um humano assina explicitamente
3. **Execução** — A transação na cadeia é enviada
4. **Verificação** — A reconciliação confirma; a XRPL atesta o registro

Nenhuma etapa é opcional. Nenhuma etapa é automatizada.

---

## Princípios

| Princípio | Implementação |
|-----------|---------------|
| Registros apenas de adição | Sem ATUALIZAR, sem EXCLUIR — apenas novas entradas |
| Falha segura | A divergência interrompe o sistema, nunca se cura silenciosamente |
| Reprodução determinística | Os mesmos eventos produzem o mesmo estado, sempre |
| Apenas IA consultiva | A IA pode analisar, alertar, sugerir — nunca aprovar, assinar ou executar |
| Observação multi-cadeia | Ethereum, XRPL, Solana, L2s — camada de leitura agnóstica à cadeia |
| Identidade estrutural | Explícita, imutável, única — não biométrica, mas constitucional |

---

## Status

Versão 2.1.3. 15 pacotes de espaço de trabalho, 2.605 testes em CI, mais 3 testes de fumaça de pacote, 94,9–100% de cobertura de declarações por pacote, tudo verde. Construindo em público.

| Pacote | Testes | Propósito |
|---------|-------|---------|
| `@attestia/types` | 75 | Tipos de domínio compartilhados (zero dependências) |
| `@attestia/registrum` | 368 | Governança constitucional — 11 invariantes, dupla testemunha |
| `@attestia/ledger` | 156 | Motor de dupla entrada apenas de adição |
| `@attestia/chain-observer` | 295 | Observação multi-cadeia somente leitura (EVM + XRPL + Solana + L2s) |
| `@attestia/vault` | 91 | Cofre pessoal — portfólios, orçamentos, intenções |
| `@attestia/treasury` | 109 | Tesouraria organizacional — folha de pagamento, distribuições, portões de financiamento |
| `@attestia/reconciler` | 98 | Correspondência 3D entre sistemas + atestação do Registrum |
| `@attestia/witness` | 295 | Atestação na cadeia XRPL, governança multi-assinatura, repetição |
| `@attestia/verify` | 273 | Verificação de reprodução, evidência de conformidade, aplicação de SLA |
| `@attestia/event-store` | 263 | Persistência de eventos apenas de adição, JSONL, cadeia de hash, 34 tipos de eventos |
| `@attestia/proof` | 94 | Árvores de Merkle (RFC 6962), provas de inclusão, empacotamento de provas de atestação |
| `@attestia/sdk` | 115 | SDK de cliente HTTP tipado para consumidores externos |
| `@attestia/node` | 362 | API REST Hono — persistência durável, autenticação, multi-tenância, tesouraria/cofre/governança, OpenAPI |
| `@mcptoolshop/attestia` | 3 | O pacote npm publicado: todas as bibliotecas acima em um único pacote, com exportações de subcaminho (testes de fumaça, executados por `pnpm test`; a execução de cobertura do CI não os inclui) |
| `@attestia/demo` | — | Demonstração interativa da CLI — percorra todo o pipeline Attestia (privado, sem testes) |

### O que há de novo na versão 2.1

- **2.1.2: recuperação de falhas para o registro de eventos.** Se um escritor for interrompido no meio de uma linha, `JsonlEventStore` ignora a última linha incompleta ao reabrir, e sua primeira gravação anexa uma nova linha para que os novos eventos comecem em uma linha nova. O fragmento incompleto permanece no arquivo e é ignorado em cada carregamento. Os eventos cujo `append()` foi retornado estão no disco. Um evento danificado no meio do registro ainda faz com que o armazenamento se recuse a abrir (`INTEGRITY_VIOLATION`, com o `verifyOnLoad: true` padrão). O arquivo README do armazenamento de eventos diz [o que permanece após uma retomada](packages/event-store/README.md).
- **2.1.1: Zod 4.** A validação agora é executada no Zod 4.6.7. A redação das mensagens de validação integradas em `details.issues[].message` e em `ConfigError` foi alterada (por exemplo, `"Required"` agora é `"Invalid input: expected <type>, received undefined"`). Os códigos de erro, os caminhos de problemas, o envelope de erro HTTP e as próprias mensagens de refinamento do Attestia permanecem inalterados, portanto, corresponda aos códigos e caminhos, não ao texto da mensagem.
- **2.1.0: um registro de eventos durável para o serviço.** `ATTESTIA_EVENTS_FILE` abre esse arquivo como o registro de eventos do proprietário configurado. Se não estiver definido, o serviço permanece na memória. Uma entrada `API_KEYS` malformada não coloca mais a chave no erro de inicialização.

Veja [CHANGELOG.md](CHANGELOG.md) para a lista completa.

### Desenvolvimento

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,597)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Testes de integração XRPL

Um nó `rippled` independente é executado no Docker para testes de integração determinísticos na cadeia — sem dependência de testnet, sem torneira, fechamento do livro-razão em menos de um segundo.

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
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gráfico do pacote, fluxos de dados, modelo de segurança |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pilhas de 5 camadas, padrões de implantação, limites de confiança |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integração de API com exemplos de curl + uso do SDK |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guia de reprodução passo a passo para auditores |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Análise STRIDE por componente |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mapeamentos de ameaça → controle → arquivo → teste |
| [SECURITY.md](SECURITY.md) | Política de divulgação responsável |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista de verificação de preparação para adoção |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Benchmarks registrados |

---

## Segurança e escopo de dados

- **Dados acessados:** Lê e grava entradas do livro-razão financeiro, registros de atestado e provas criptográficas. O serviço grava seu registro de eventos no arquivo nomeado por `ATTESTIA_EVENTS_FILE` quando ele é definido. Conecta-se a nós de blockchain (XRPL) quando o módulo de testemunha está ativo.
- **Dados NÃO acessados:** Sem telemetria. Sem armazenamento de credenciais de usuário. Sem análise de terceiros.
- **Integridade no disco:** o registro de eventos é apenas de anexação e encadeado por hash. Uma última linha incompleta de uma falha é ignorada e o registro é retomado; qualquer dano que quebre a cadeia faz com que o armazenamento se recuse a abrir por padrão.
- **Permissões necessárias:** Acesso de leitura/gravação aos diretórios de dados locais. Acesso à rede apenas para atestado de blockchain. Veja [THREAT_MODEL.md](THREAT_MODEL.md) para a análise STRIDE completa.

## Placar

| Portão | Status |
|------|--------|
| A. Linha de base de segurança | APROVADO |
| B. Tratamento de erros | APROVADO |
| C. Documentação do operador | APROVADO |
| D. Higiene de envio | APROVADO |
| E. Identidade | APROVADO |

## Licença

[MIT](LICENSE)

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
