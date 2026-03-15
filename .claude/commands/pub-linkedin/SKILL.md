---
name: pub-linkedin
description: Genera un post de LinkedIn sobre el proyecto actual. Úsala cuando el usuario quiera publicar o compartir el proyecto en LinkedIn.
---

# pub-linkedin — Post de LinkedIn del proyecto

## Goal
Redactar un post de LinkedIn optimizado para engagement que explique el proyecto actual de forma clara, auténtica y técnicamente honesta.

## Instructions

1. **Recopila contexto** leyendo en este orden (usa lo que esté disponible):
   - `CLAUDE.md` → nombre, descripción, stack, arquitectura
   - `README.md` → funcionalidades destacadas
   - `git log --oneline -15` → últimos avances (muestra progreso real)
   - `webapp/package.json` o `requirements.txt` → dependencias clave (tecnologías)

2. **Redacta el post** siguiendo esta estructura:

   ```
   [GANCHO — 1 línea] Frase que genera curiosidad o conecta con un problema real.

   [CONTEXTO — 2-3 líneas] Qué es el proyecto, para quién y qué problema resuelve.

   [LO QUE HE CONSTRUIDO — 3-5 bullets]
   → Funcionalidad 1 concreta
   → Funcionalidad 2 concreta
   → ...

   [STACK / DECISIONES TÉCNICAS — 2-3 líneas] Tecnologías elegidas y por qué.

   [APRENDIZAJE O RETO — 1-2 líneas] Algo honesto aprendido o un obstáculo superado.

   [CTA] Pregunta abierta o invitación a comentar/probar.

   [HASHTAGS] 5-8 hashtags relevantes al final, sin saturar.
   ```

3. **Tono y estilo**:
   - Primera persona, voz directa, sin jerga corporativa
   - Máximo 1.300 caracteres (límite óptimo LinkedIn antes del "ver más")
   - Sin emojis excesivos: máximo 1 por bullet, 0 en el gancho
   - Hashtags: mezcla técnicos (`#JavaScript`, `#PWA`) y temáticos (`#OpenSource`, `#SideProject`)
   - No usar frases hechas: "Estoy orgulloso de...", "Emocionado de compartir...", "Game changer"

4. **Entrega**:
   - Muestra el post listo para copiar dentro de un bloque de código (para fácil selección)
   - Debajo, añade una línea con el recuento de caracteres
   - Ofrece una variante corta (≤ 700 chars) si el post supera 1.300 chars

## Constraints
- No inventar funcionalidades que no estén en el código o en CLAUDE.md
- No usar el nombre de empresas o personas sin confirmación del usuario
- Si el proyecto no tiene README, basar el post solo en CLAUDE.md y los commits
