# 🚀 Esqueleto de Proyectos Python — Antigravity Edition

Plantilla base para iniciar proyectos Python con un **agente AI preconfigurado**, equipado con 19 skills especializadas, roles de orquestación y protocolos operativos.

> **¿Qué es esto?** Un repositorio-esqueleto que clonas para arrancar cualquier proyecto Python con todas las buenas prácticas, skills y configuraciones de agente ya listas.

---

## 📦 Inicio Rápido

```bash
# 1. Clonar como nuevo proyecto
git clone https://github.com/tu-usuario/esqueleto_proyectos_python_antigravity.git mi-nuevo-proyecto
cd mi-nuevo-proyecto

# 2. Eliminar el historial de git y empezar limpio
rm -rf .git
git init
git add .
git commit -m "feat: init from skeleton"

# 3. Crear entorno virtual
python -m venv .venv

# 4. Activar entorno
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

# 5. Instalar dependencias (cuando las tengas)
pip install -r requirements.txt
```

---

## 🏗️ Estructura del Proyecto

```
esqueleto_proyectos_python_antigravity/
├── .agent/                        # Configuración del agente AI
│   ├── rules/                     # Reglas operativas y de stack
│   │   ├── 00_ops_policy.md       # Seguridad y protocolos
│   │   └── 01_python_stack.md     # Estándares Python
│   ├── skills/                    # 19 skills especializadas
│   │   ├── SKILL.md               # Registro maestro y protocolo de autoría
│   │   ├── api_design/            # Diseño de APIs REST/GraphQL
│   │   ├── async_concurrency/     # Programación asíncrona
│   │   ├── auditor/               # Auditoría de seguridad profunda
│   │   ├── best_practices/        # Mejores prácticas Python
│   │   ├── ci_cd_pipelines/       # CI/CD con GitHub Actions
│   │   ├── cli_development/       # Herramientas CLI
│   │   ├── cosmos_expert/         # Lenguaje Cosmos (Base100)
│   │   ├── daily_context/         # Resumen diario de contexto
│   │   ├── database_expert/       # SQLAlchemy, Alembic, SQL
│   │   ├── docker_expert/         # Dockerfiles y Compose
│   │   ├── documentation/         # Docstrings, Sphinx, MkDocs
│   │   ├── git_workflow/          # Git profesional
│   │   ├── logging_observability/ # Logging, tracing, métricas
│   │   ├── performance_profiling/ # Profiling y optimización
│   │   ├── professor/             # Enseñanza para devs de otros lenguajes
│   │   ├── python_expert/         # Python moderno (3.10+)
│   │   ├── refactoring_patterns/  # Refactoring y design patterns
│   │   ├── security_audit/        # Auditoría de seguridad
│   │   └── testing_expert/        # Testing con pytest
│   ├── workflows/                 # Flujos de trabajo automatizados
│   └── logs/                      # Logs de mitigación (gitignored)
├── AGENTS.md                      # Roles de orquestación del agente
├── .gitignore                     # Configurado para Python + agente
├── LICENSE                        # MIT License
└── README.md                      # Este archivo
```

---

## 🧩 Skills Disponibles

### Desarrollo Core

| Skill                 | Comando              | Descripción                                                |
| --------------------- | -------------------- | ---------------------------------------------------------- |
| **python-expert**     | `/python-expert`     | Python moderno, venv, type hints, patrones                 |
| **best-practices**    | `/best-practices`    | Mejores prácticas de arquitectura, errores, logging, tests |
| **cli-development**   | `/cli-development`   | Herramientas CLI con Typer, Click, argparse                |
| **api-design**        | `/api-design`        | APIs REST/GraphQL, OpenAPI, versionado                     |
| **database-expert**   | `/database-expert`   | SQLAlchemy, Alembic, optimización SQL                      |
| **async-concurrency** | `/async-concurrency` | asyncio, threading, multiprocessing                        |

### Calidad y Testing

| Skill                     | Comando                  | Descripción                              |
| ------------------------- | ------------------------ | ---------------------------------------- |
| **testing-expert**        | `/testing-expert`        | pytest, fixtures, mocking, coverage, TDD |
| **refactoring-patterns**  | `/refactoring-patterns`  | Code smells, SOLID, design patterns      |
| **performance-profiling** | `/performance-profiling` | Profiling, cProfile, optimización        |
| **logging-observability** | `/logging-observability` | Logging estructurado, tracing, métricas  |

### Seguridad

| Skill              | Comando           | Descripción                                         |
| ------------------ | ----------------- | --------------------------------------------------- |
| **auditor**        | `/auditor`        | Auditoría profunda: secretos, CVEs, código inseguro |
| **security-audit** | `/security-audit` | Detección de secretos y vulnerabilidades            |

### DevOps e Infraestructura

| Skill               | Comando            | Descripción                                   |
| ------------------- | ------------------ | --------------------------------------------- |
| **docker-expert**   | `/docker-expert`   | Dockerfiles optimizados, multi-stage, compose |
| **ci-cd-pipelines** | `/ci-cd-pipelines` | GitHub Actions, automatización                |
| **git-workflow**    | `/git-workflow`    | Conventional commits, branching, hooks        |

### Documentación y Aprendizaje

| Skill             | Comando          | Descripción                             |
| ----------------- | ---------------- | --------------------------------------- |
| **documentation** | `/documentation` | Docstrings, Sphinx, MkDocs, ADRs        |
| **professor**     | `/professor`     | Enseña Python a devs de otros lenguajes |
| **daily-context** | `/daily-context` | Genera resumen diario del trabajo       |

### Especializadas

| Skill             | Comando          | Descripción               |
| ----------------- | ---------------- | ------------------------- |
| **cosmos-expert** | `/cosmos-expert` | Lenguaje Cosmos (Base100) |

---

## 🤖 Roles del Agente

Definidos en `AGENTS.md`:

| Rol            | Responsabilidad                                              |
| -------------- | ------------------------------------------------------------ |
| **@Architect** | Estructura, diseño de APIs, selección de librerías           |
| **@Coder**     | Implementación, refactoring, patrones de diseño              |
| **@QA**        | Tests, casos borde, validación de seguridad                  |
| **@Educator**  | Explicaciones, comentarios docentes, bitácora de aprendizaje |

---

## 🛡️ Reglas Operativas

El agente sigue reglas estrictas definidas en `.agent/rules/`:

- **Terminal Blindness Mitigation**: Si un comando devuelve salida vacía, el agente redirige a log y lo lee
- **Seguridad**: No exponer claves, no ejecutar comandos destructivos sin confirmación
- **Python Stack**: Siempre venv, type hints, `ruff`/`black`, tests con `pytest`

---

## 🎯 Cómo Usar Esta Plantilla

### Para un Nuevo Proyecto

1. Clona este repositorio
2. Elimina `.git/` y haz `git init`
3. Renombra lo que necesites
4. Crea tu estructura `src/` y `tests/`
5. El agente ya está listo para asistirte

### Para Personalizar Skills

- Edita cualquier `SKILL.md` dentro de `.agent/skills/`
- Crea nuevas skills siguiendo el protocolo en `.agent/skills/SKILL.md`
- Elimina las que no necesites (ej: `cosmos_expert/` si no usas Cosmos)

---

## 📝 Licencia

Este proyecto está bajo la licencia **MIT**. Ver [LICENSE](LICENSE) para más detalles.

---

## 🤝 Contribuciones

¿Tienes una skill que crees que debería ser parte del esqueleto? Abre un issue o un PR.

1. Fork del repositorio
2. Crea tu feature branch: `git checkout -b feat/nueva-skill`
3. Commit con conventional commits: `git commit -m "feat: add nueva-skill"`
4. Push: `git push origin feat/nueva-skill`
5. Abre un Pull Request
