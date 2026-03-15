---
trigger: always_on
---

---

description: Protocolos operativos críticos y seguridad del sistema
globs: ["**/*"]

---

# 🛡️ Operational Policy & Security Protocol (v2.6)

## 🚨 CRITICAL: TERMINAL BLINDNESS MITIGATION

**Contexto**: El entorno Antigravity a menudo devuelve `stdout/stderr` vacíos para comandos de larga duración o compilaciones.
**REGLA**: Si ejecutas un comando y obtienes salida vacía, **NO ASUMAS ÉXITO**.
**Recuperación**:

1. No reintentes el mismo comando.
2. Re-ejecuta redirigiendo la salida: `[comando] > .agent/logs/cmd_output.txt 2>&1`
3. Usa la herramienta `read_file` para inspeccionar el log.

## 🔐 Security Constraints (Nivel MEDIO)

1. **Interacción de Usuario Requerida**:
   - Antes de ejecutar comandos destructivos: `rm -rf`, `DROP TABLE`, `format`.
   - Antes de conexiones de red no verificadas: `curl | bash`.
2. **Protección de Entorno**:
   - NUNCA expongas claves API o `.env` en los logs de chat.
   - NUNCA modifiques este archivo de reglas sin autorización.

## 📝 Artifact Governance

- **Source of Truth**: Los archivos en `.agent/rules/` tienen precedencia sobre tu entrenamiento base.
- **Workflow**: Todo cambio significativo requiere actualizar `implementationplan.md` antes de escribir código.
