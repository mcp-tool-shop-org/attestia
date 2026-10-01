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

<p align="center"><strong>Prueba de que un evento, una transacción o una transición de estado tuvo lugar, vinculada a una cadena.</strong></p>

---

## Misión

Creemos que el dinero, dondequiera que se encuentre y cómo se mueva, merece el mismo rigor que los sistemas que lo crearon. Los contratos inteligentes se ejecutan. Las cadenas de bloques registran. Pero nadie *da fe*.

Attestia ofrece esa capa para el dinero: gobernanza estructural, contabilidad determinista e intención aprobada por humanos, en todas las cadenas, organizaciones e individuos.

No movemos su dinero. Demostramos lo que sucedió, limitamos lo que puede suceder y hacemos que el registro financiero sea inquebrantable.

### Lo que defendemos

- **La verdad por encima de la velocidad.** Cada evento financiero es de solo agregado, reproducible y conciliable. Si no se puede probar, no sucedió.
- **Los humanos aprueban; las máquinas verifican.** La IA asesora, los contratos inteligentes se ejecutan, pero nada se mueve sin la autorización humana explícita. Nunca.
- **Gobernanza estructural, no gobernanza política.** No votamos sobre lo que es válido. Definimos invariantes que se cumplen incondicionalmente: la identidad es explícita, la línea de descendencia es ininterrumpida, el orden es determinista.
- **La intención no es la ejecución.** Declarar lo que se desea y hacerlo son actos separados con puertas de enlace separadas. La brecha entre ellos es donde reside la confianza.
- **Las cadenas son testigos, no autoridades.** XRPL da fe. Ethereum liquida. Pero la autoridad proviene de reglas estructurales, no del consenso de ninguna cadena.
- **La infraestructura aburrida es la que triunfa.** El mundo no necesita otro protocolo DeFi. Necesita la capa de contabilidad subyacente, la infraestructura financiera que hace que todo lo demás sea confiable.

## Lugar en el sistema

Attestia, Cognate y RepoMesh son tres productos.

**Attestia** demuestra que un evento, una transacción o una transición de estado tuvo lugar y vincula esa prueba a una cadena. El dominio que ofrece es la verdad financiera: bóveda personal, tesorería de la organización y registro. Sus primitivas de prueba son un almacén de eventos de solo agregado y pruebas de Merkle.

**Cognate** es el dominio de gobernanza de IA en esas primitivas: modelo de línea de descendencia, decisiones de política, capacidades del agente e integridad del mensaje y la salida. No mantiene un segundo almacén de eventos.

**RepoMesh** es la red de lanzamiento: eventos firmados, manifiestos de nodos y un reloj de confianza anclado en XRPL. Mantiene su propio libro mayor RFC 6962. No utiliza el árbol de Merkle de Attestia.

Cognate llama a Attestia cuando necesita una prueba y a RepoMesh cuando necesita que se verifique un lanzamiento.

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
| **Personal Vault** | Observación de cartera multi-cadena, presupuestación de sobres, declaración de intenciones | Evolucionado de NextLedger |
| **Org Treasury** | Nómina determinista, distribuciones de DAO, financiación de doble puerta de enlace, libro mayor de doble entrada | Evolucionado de Payroll Engine |
| **Registrum** | Registrador estructural: 11 invariantes, validación de doble testigo, atestación de XRPL | Sin cambios: capa constitucional |

---

## Pruébelo en 2 minutos

La forma más rápida de comprender Attestia es observar cómo un pago fluye a través de todo el proceso. La demostración interactiva ejecuta la secuencia completa de **Intención → Aprobación → Ejecución → Verificación → Atestación → Prueba** de principio a fin; cada etapa se calcula en tiempo real con los paquetes de dominio reales (coincidencia, hash, atestación de estilo XRPL, prueba de Merkle), no una simulación.

```bash
pnpm install   # Install all dependencies
pnpm build     # Build all packages
pnpm demo      # Walk the full pipeline (~10s, paced for readability)
```

Verá cómo un único pago de nómina se convierte en una prueba criptográfica verificable de forma independiente, paso a paso. Agregue `--fast` para omitir el ritmo y ejecutarlo instantáneamente: `pnpm demo --fast` (`pnpm demo --help` enumera todas las marcas).

---

## Patrón central

Cada interacción sigue un flujo:

```
Intent → Approve → Execute → Verify
```

1. **Intención:** un usuario o sistema declara el resultado deseado
2. **Aprobación:** Registrum valida estructuralmente; un humano firma explícitamente
3. **Ejecución:** se envía la transacción en la cadena
4. **Verificación:** la conciliación confirma; XRPL da fe del registro

Ningún paso es opcional. Ningún paso se automatiza.

---

## Principios

| Principio | Implementación |
|-----------|---------------|
| Registros de solo agregado | No hay ACTUALIZACIÓN, no hay ELIMINACIÓN: solo nuevas entradas |
| Falla de forma segura | El desacuerdo detiene el sistema, nunca se cura en silencio |
| Reproducción determinista | Los mismos eventos producen el mismo estado, siempre |
| Solo IA de asesoramiento | La IA puede analizar, advertir, sugerir, pero nunca aprobar, firmar o ejecutar |
| Observación multi-cadena | Ethereum, XRPL, Solana, L2: capa de lectura agnóstica de la cadena |
| Identidad estructural | Explícita, inmutable, única: no biométrica, sino constitucional |

---

## Estado

14 paquetes, 2564 pruebas, 95% de cobertura, todo en verde. Construyendo en público.

| Paquete | Pruebas | Propósito |
|---------|-------|---------|
| `@attestia/types` | 75 | Tipos de dominio compartidos (cero dependencias) |
| `@attestia/registrum` | 368 | Gobernanza constitucional: 11 invariantes, doble testigo |
| `@attestia/ledger` | 156 | Motor de doble entrada de solo agregado |
| `@attestia/chain-observer` | 295 | Observación de solo lectura multi-cadena (EVM + XRPL + Solana + L2) |
| `@attestia/vault` | 91 | Bóveda personal: carteras, presupuestos, intenciones |
| `@attestia/treasury` | 109 | Tesorería de la organización: nómina, distribuciones, puertas de enlace de financiación |
| `@attestia/reconciler` | 98 | Coincidencia cruzada 3D + atestación de Registrum |
| `@attestia/witness` | 295 | Atestación en la cadena XRPL, gobernanza multi-firma, reintento |
| `@attestia/verify` | 273 | Verificación de reproducción, evidencia de cumplimiento, aplicación de SLA |
| `@attestia/event-store` | 253 | Persistencia de eventos de solo agregado, JSONL, cadena de hash, 34 tipos de eventos |
| `@attestia/proof` | 94 | Árboles de Merkle (RFC 6962), pruebas de inclusión, empaquetado de pruebas de atestación |
| `@attestia/sdk` | 115 | SDK de cliente HTTP con tipado para consumidores externos |
| `@attestia/node` | 342 | API REST de Hono: persistencia duradera, autenticación, multi-tenencia, gestión de activos/bóveda/gobernanza, OpenAPI |
| `@attestia/demo` | — | Demostración interactiva en la CLI: recorrido completo del flujo de trabajo de Attestia (privado, sin pruebas) |

### Desarrollo

```bash
pnpm install          # Install all dependencies
pnpm build            # Build all packages
pnpm test             # Run all tests (2,564)
pnpm test:coverage    # Run with coverage reporting
pnpm typecheck        # Type-check all packages
pnpm bench            # Run benchmarks
```

### Pruebas de integración de XRPL

Un nodo `rippled` independiente se ejecuta en Docker para realizar pruebas de integración deterministas en la cadena de bloques: sin dependencia de una red de prueba, sin necesidad de un "faucet", cierre del libro mayor en menos de un segundo.

```bash
docker compose up -d              # Start standalone rippled
pnpm --filter @attestia/witness run test:integration  # Run on-chain round-trip tests
docker compose down               # Stop rippled
```

### Documentación

| Documento | Propósito |
|----------|---------|
| [HANDBOOK.md](HANDBOOK.md) | Resumen ejecutivo y referencia completa del paquete |
| [ROADMAP.md](ROADMAP.md) | Hoja de ruta del proyecto por fases |
| [DESIGN.md](DESIGN.md) | Decisiones de arquitectura |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Gráfico del paquete, flujos de datos, modelo de seguridad |
| [REFERENCE_ARCHITECTURE.md](REFERENCE_ARCHITECTURE.md) | Pila de 5 capas, patrones de implementación, límites de confianza |
| [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Integración de la API con ejemplos de curl + uso del SDK |
| [VERIFICATION_GUIDE.md](VERIFICATION_GUIDE.md) | Guía paso a paso para la auditoría |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Análisis STRIDE por componente |
| [CONTROL_MATRIX.md](CONTROL_MATRIX.md) | Mapeo de amenaza → control → archivo → prueba |
| [SECURITY.md](SECURITY.md) | Política de divulgación responsable |
| [INSTITUTIONAL_READINESS.md](INSTITUTIONAL_READINESS.md) | Lista de verificación de preparación para la adopción |
| [PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md) | Pruebas de rendimiento registradas |

---

## Alcance de seguridad y datos

- **Datos a los que se accede:** Lee y escribe entradas del libro mayor financiero, registros de atestación y pruebas criptográficas. Se conecta a nodos de la cadena de bloques (XRPL) cuando el módulo de testigo está activo.
- **Datos a los que NO se accede:** No se recopila telemetría. No se almacenan credenciales de usuario. No se utilizan análisis de terceros.
- **Permisos requeridos:** Acceso de lectura/escritura a los directorios de datos locales. Acceso a la red solo para la atestación en la cadena de bloques. Consulte [THREAT_MODEL.md](THREAT_MODEL.md) para obtener el análisis STRIDE completo.

## Tabla de resultados

| Control | Estado |
|------|--------|
| A. Línea base de seguridad | APROBADO |
| B. Manejo de errores | APROBADO |
| C. Documentación para operadores | APROBADO |
| D. Buenas prácticas de lanzamiento | APROBADO |
| E. Identidad | APROBADO |

## Licencia

[MIT](LICENSE)

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
