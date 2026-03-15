---
trigger: always_on
---

---

description: Estándares de desarrollo para Python, gestión de dependencias y calidad de código
globs: ["**/*.py", "requirements.txt", "pyproject.toml", "poetry.lock"]

---

# 🐍 Python Development Standards

## 📦 Gestión de Dependencias

- **Virtual Environment**: SIEMPRE usa un entorno virtual (`venv` o `.venv`).
  - Activación: `source .venv/bin/activate` antes de instalar paquetes.
  - NUNCA uses `pip install` en el sistema global.
- **Lockfiles**: Mantén `requirements.txt` o `poetry.lock` sincronizados tras cada instalación.

## 🧪 Calidad y Testing

- **Type Hinting**: Todo código nuevo debe incluir type hints (PEP 484).
- **Linter**: Usa `ruff` o `black` para formateo antes de confirmar cambios.
- **Tests**:
  - Ubicación: carpeta `tests/`.
  - Framework: `pytest`.
  - Regla: No se marca una tarea como "Done" sin un test que verifique la funcionalidad.

## 🐛 Debugging Pattern

Si encuentras un `ModuleNotFoundError`:

1. Verifica si el entorno virtual está activo.
2. Verifica si el paquete está en `requirements.txt`.
3. Instala explícitamente y actualiza el archivo de dependencias.
