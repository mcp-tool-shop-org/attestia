<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

<p align="center"><strong>Infraestructura de verdad financiera para el mundo descentralizado.</strong></p>

---

## Misión

Creemos que el dinero — dondequiera que se encuentre, cómo quiera que se mueva— merece el mismo rigor que los sistemas que lo crearon. Los contratos inteligentes se ejecutan. Las cadenas de bloques registran. Pero nadie *da fe*.

Attestia es la capa que faltaba: gobernanza estructural, contabilidad determinista e intención aprobada por humanos, todo ello unificado en diferentes cadenas, organizaciones e individuos.

No movemos su dinero. Demostramos lo que sucedió, limitamos lo que puede suceder y hacemos que el registro financiero sea inquebrantable.

### Lo que defendemos

- **La verdad por encima de la velocidad.** Cada evento financiero es de solo adición, reproducible y conciliable. Si no se puede probar, no sucedió.
- **Los humanos aprueban; las máquinas verifican.** La IA asesora, los contratos inteligentes se ejecutan, pero nada se mueve sin una autorización humana explícita. Nunca.
- **Gobernanza estructural, no gobernanza política.** No votamos sobre lo que es válido. Definimos invariantes que se cumplen incondicionalmente: la identidad es explícita, el linaje es ininterrumpido y el orden es determinista.
- **La intención no es ejecución.** Declarar lo que quieres y hacerlo son actos separados con puertas de entrada separadas. La brecha entre ellos es donde reside la confianza.
- **Las cadenas son testigos, no autoridades.** XRPL da fe. Ethereum liquida. Pero la autoridad emana de las reglas estructurales, no del consenso de ninguna cadena.
- **La infraestructura aburrida gana.** El mundo no necesita otro protocolo DeFi. Necesita la capa de contabilidad subyacente: la infraestructura financiera que hace que todo lo demás sea confiable.

---

## Arquitectura

Attestia es tres sistemas, una verdad:

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

| Sistema | Función | Origen |
|--------|------|--------|
| **Personal Vault** | Observación de carteras multi-cadena, presupuestos envolventes, declaración de intenciones | Evolucionado a partir de NextLedger |
| **Org Treasury** | Nómina determinista, distribuciones DAO, financiación de doble puerta, libro mayor de contabilidad de partida doble | Evolucionado a partir de Payroll Engine |
| **Registrum** | Registrador estructural: 11 invariantes, validación de doble testigo, atestación XRPL | Inalterable: capa constitucional |

---

## Pruébalo en 2 minutos

La forma más rápida de comprender Attestia es observar cómo un pago fluye a través de todo el proceso. La demostración interactiva ejecuta la secuencia completa **Intención → Aprobación → Ejecución → Verificación → Atestación → Prueba** de principio a fin; cada etapa se calcula en tiempo real con los paquetes de dominio reales (coincidencia, hash, atestación al estilo XRPL, prueba Merkle), no una simulación.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Verá cómo un único pago de nómina se convierte en una prueba criptográfica verificable de forma independiente, paso a paso. Agregue `--fast` para omitir el ritmo y ejecutarlo instantáneamente: `pnpm demo --fast` (`pnpm demo --help` enumera todas las opciones).

---

## Patrón central

Cada interacción sigue un flujo:

```
Intent → Approve → Execute → Verify
```

1. **Intención:** Un usuario o sistema declara el resultado deseado.
2. **Aprobación:** Registrum valida estructuralmente; un humano firma explícitamente.
3. **Ejecución:** Se envía la transacción en cadena.
4. **Verificación:** La conciliación confirma; XRPL da fe del registro.

Ningún paso es opcional. Ningún paso se automatiza por completo.

---

## Principios

| Principio | Implementación |
|-----------|---------------|
| Registros de solo adición | No hay ACTUALIZAR, no hay ELIMINAR: solo nuevas entradas. |
| Falla segura | El desacuerdo detiene el sistema, nunca se corrige en silencio. |
| Reproducción determinista | Los mismos eventos producen el mismo estado, siempre. |
| Solo IA de asesoramiento | La IA puede analizar, advertir y sugerir; nunca aprobar, firmar o ejecutar. |
| Observación multi-cadena | Ethereum, XRPL, Solana, L2: capa de lectura agnóstica a la cadena. |
| Identidad estructural | Explícita, inmutable, única; no biométrica, sino constitucional. |

---

## Estado

14 paquetes, 2564 pruebas, más del 95% de cobertura, todo en verde. Construyendo en público.

| Paquete | Pruebas | Propósito |
|---------|-------|---------|
| `@attestia/types` | 75 | Tipos de dominio compartidos (cero dependencias) |
| `@attestia/registrum` | 368 | Gobernanza constitucional: 11 invariantes, doble testigo. |
| `@attestia/ledger` | 156 | Motor de contabilidad de partida doble de solo adición. |
| `@attestia/chain-observer` | 295 | Observación de solo lectura multi-cadena (EVM + XRPL + Solana + L2). |
| `@attestia/vault` | 91 | Bóveda personal: carteras, presupuestos, intenciones. |
| `@attestia/treasury` | 109 | Tesorería organizacional: nómina, distribuciones, puertas de financiación. |
| `@attestia/reconciler` | 98 | Coincidencia cruzada en 3D + atestación Registrum. |
| `@attestia/witness` | 295 | Atestación en cadena XRPL, gobernanza multi-firma, reintento. |
| `@attestia/verify` | 273 | Verificación de reproducción, evidencia de cumplimiento, aplicación de SLA. |
| `@attestia/event-store` | 253 | Persistencia de eventos de solo adición, JSONL, cadena hash, 34 tipos de eventos. |
| `@attestia/proof` | 94 | Árboles Merkle (RFC 6962), pruebas de inclusión, empaquetado de prueba de atestación. |
| `@attestia/sdk` | 115 | SDK de cliente HTTP tipificado para consumidores externos. |
| `@attestia/node` | 342 | API REST Hono: persistencia duradera, autenticación, multi-inquilinato, tesorería/bóveda/gobernanza, OpenAPI. |
| `@attestia/demo` | — | Demostración interactiva de CLI: recorra toda la secuencia de Attestia (privada, sin pruebas). |

### Desarrollo

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Pruebas de integración XRPL

Un nodo `rippled` independiente se ejecuta en Docker para realizar pruebas de integración en cadena deterministas: no hay dependencia de la red de prueba, ni necesidad de grifo, cierre de libro mayor en menos de un segundo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentación

| Documento | Propósito |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Descripción general y referencia completa del paquete. |
| [ROADMAP.md](ROADMAP.md) | Hoja de ruta del proyecto por fases. |
| [DESIGN.md](DESIGN.md) | Decisiones arquitectónicas. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gráfico de paquetes, flujos de datos, modelo de seguridad. |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pila de 5 capas, patrones de implementación, límites de confianza. |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integración de API con ejemplos de curl + uso del SDK. |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guía paso a paso para la auditoría |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Análisis STRIDE por componente |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Correspondencias entre amenaza, control, archivo y prueba |
| [SECURITY.md](SECURITY.md) | Política de divulgación responsable |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista de verificación de preparación para la implementación |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Puntos de referencia registrados |

---

## Alcance de seguridad y datos

- **Datos a los que se accede:** Lee y escribe entradas del libro mayor financiero, registros de certificación y pruebas criptográficas. Se conecta a nodos de blockchain (XRPL) cuando el módulo de testigo está activo.
- **Datos a los que NO se accede:** No hay telemetría. No hay almacenamiento de credenciales de usuario. No hay análisis de terceros.
- **Permisos requeridos:** Acceso de lectura/escritura a directorios de datos locales. Acceso a la red solo para la certificación de blockchain. Consulte [THREAT_MODEL.md](THREAT_MODEL.md) para obtener el análisis STRIDE completo.

## Tabla de resultados

| Puerta de enlace | Estado |
|------|--------|
| A. Línea base de seguridad | APROBADO |
| B. Manejo de errores | APROBADO |
| C. Documentación para operadores | APROBADO |
| D. Buenas prácticas de envío | APROBADO |
| E. Identidad | APROBADO |

## Licencia

[MIT](LICENSE)

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
