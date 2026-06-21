<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/Attestia/readme.png" alt="Attestia" width="400">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mcptoolshop/attestia"><img src="https://img.shields.io/npm/v/@mcptoolshop/attestia" alt="npm version"></a>
  <a href="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml"><img src="https://github.com/mcp-tool-shop-org/attestia/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://opensource.org/license/mit/"><img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License"></a>
</p>

<p align="center"><strong>Infraestrutura de verdade financeira para o mundo descentralizado – toda a biblioteca Attestia em um único pacote.</strong></p>

Governança estrutural, contabilidade determinística e intenção aprovada por humanos — unificados entre cadeias, organizações e indivíduos. A Attestia não move seu dinheiro; ela comprova o que aconteceu, restringe o que pode acontecer e torna o registro financeiro inviolável.

Este pacote reúne toda a biblioteca Attestia em uma única instalação (ESM). Os pacotes internos `@attestia/*` são incorporados — não há necessidade de gerenciar a proliferação de pacotes; as dependências de tempo de execução de terceiros (xrpl, viem, @solana/web3.js, json-canonicalize, ripple-keypairs) são resolvidas normalmente.

## Instalação

```bash
npm install @mcptoolshop/attestia
```

> **Apenas ESM** (Node ≥ 22). Publicado com [npm provenance](https://docs.npmjs.com/generating-provenance-statements) via GitHub Actions OIDC Trusted Publishing.

## Uso

Importe um domínio como um **namespace** a partir da raiz:

```ts
import { ledger, proof, registrum } from "@mcptoolshop/attestia";

const total = ledger.addMoney(
  { amount: "100.00", currency: "USD", decimals: 2 },
  { amount: "50.00", currency: "USD", decimals: 2 },
);

const tree = proof.MerkleTree.build([/* sha-256 leaf hashes */]);
```

…ou importe símbolos individuais de um **subcaminho**:

```ts
import { MerkleTree, verifyAttestationProof } from "@mcptoolshop/attestia/proof";
import { StructuralRegistrar } from "@mcptoolshop/attestia/registrum";
import { JsonlEventStore } from "@mcptoolshop/attestia/event-store";
import { AttestiaClient } from "@mcptoolshop/attestia/sdk";
```

## Subcaminhos

| Subcaminho | O que é |
|---------|-----------|
| `@mcptoolshop/attestia` | Arquivo raiz — cada domínio como um namespace |
| `…/types` | Tipos de domínio compartilhados (Dinheiro, IDs, primitivas personalizadas) |
| `…/ledger` | Mecanismo de registro de dupla entrada com anexação exclusiva + matemática determinística do dinheiro |
| `…/registrum` | Registrador constitucional — 11 invariantes, dupla testemunha |
| `…/event-store` | Persistência de eventos com anexação exclusiva — JSONL, cadeia de hash |
| `…/proof` | Árvores de Merkle (RFC 6962), inclusão + provas de atestação |
| `…/vault` | Cofre pessoal — portfólios, orçamentos, intenções |
| `…/treasury` | Tesouraria da organização — folha de pagamento, distribuições, mecanismos de financiamento |
| `…/reconciler` | Correspondência entre sistemas + atestação do Registrum |
| `…/chain-observer` | Observação somente leitura em várias cadeias (EVM, XRPL, Solana, L2s) |
| `…/witness` | Atestação on-chain da XRPL, governança multiassinatura |
| `…/verify` | Verificação de repetição, evidência de conformidade, SLA |
| `…/sdk` | Cliente HTTP tipado para a API REST da Attestia |

## Padrão principal

Cada interação segue um fluxo e nenhum passo é opcional:

```
Intent → Approve → Execute → Verify
```

## Documentação

Manual completo, arquitetura, modelo de ameaças e guia de verificação: **<https://mcp-tool-shop-org.github.io/attestia/>** · Fonte: **<https://github.com/mcp-tool-shop-org/attestia>**

## Licença

[MIT](LICENSE) — desenvolvido por [MCP Tool Shop](https://mcp-tool-shop.github.io/).
