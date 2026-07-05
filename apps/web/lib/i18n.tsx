'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'es' | 'en' | 'fr';

export const LANGS: { code: Lang; label: string; flag: string }[] = [
  { code: 'es', label: 'Español', flag: 'ES' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'fr', label: 'Français', flag: 'FR' },
];

type Dict = Record<string, string>;

/**
 * UI translation dictionary. Keys are stable; the detailed memo body stays in
 * technical English (industry standard) while all chrome, the verdict and
 * section headings are localized.
 */
const DICT: Record<Lang, Dict> = {
  en: {
    'app.tagline': 'Document-grounded agent for designing and monitoring loan covenants',
    'mode.before': 'Design covenants · BEFORE',
    'mode.after': 'Monitor · AFTER',
    'btn.run': 'Run agent',
    'btn.stop': 'Stop',
    'btn.docs': 'Documents',
    'btn.exit': 'exit',
    'operator.guest': 'Guest analyst',
    'badge.offline': 'OFFLINE · deterministic planner',
    'badge.retriever': 'retriever',
    'badge.loop': 'loop',
    // step rail
    'step.1.title': 'Pick the question',
    'step.1.hint.after': 'Monitor an existing covenant',
    'step.1.hint.before': 'Design a new covenant package',
    'step.2.title': 'Run the agent',
    'step.2.hint': 'Watch it plan, retrieve, calculate & decide — live',
    'step.3.title': 'Read the answer',
    'step.3.hint': 'A cited memo you can defend, number by number',
    // panels
    'panel.trace': '① How it thinks · live',
    'panel.answer.after': '② The answer · cited memo',
    'panel.answer.before': '② The answer · covenant proposal',
    'trace.count': 'steps',
    'trace.running': 'running',
    // trace empty
    'empty.trace.lead': 'Watch the agent work, step by step',
    'empty.trace.sub':
      'Not a chatbot — a real agent. It plans, searches the documents, runs the calculations and decides, live. Every step shows here so you can audit exactly how it reached the answer.',
    'empty.cue.start': 'to start',
    'empty.cue.generate': 'to generate it',
    'empty.press': 'Press',
    // answer empty
    'empty.answer.after.lead': 'You’ll get a cited escalation memo',
    'empty.answer.after.sub':
      'Which covenant is drifting, how close to breach, when it breaks, why — every number linked to its source document, with a confidence level.',
    'empty.answer.before.lead': 'You’ll get a justified covenant proposal',
    'empty.answer.before.sub':
      'Which ratios to covenant and what threshold for each, backed by volatility and stress evidence — every number calculated and cited, never guessed.',
    'answer.composing': 'Composing the answer — sections appear here as the agent finishes each one.',
    // memo meta
    'memo.citedFacts': 'cited facts',
    'memo.planner': 'planner',
    'memo.loop': 'loop',
    'memo.needsReview':
      '⚠ Confidence is LOW on at least one item — this output is routed to human review and must not be auto-published.',
    'section.needsReview': 'needs review',
    'draftedBy.llm': 'LLM-drafted · guard-verified',
    // run gate
    'gate.after': 'This company needs ≥4 consecutive quarters and defined covenants to monitor (AFTER).',
    'gate.before': 'This company needs ≥4 consecutive quarters to design covenants (BEFORE).',
    // verdict pop-up
    'verdict.title': 'Analysis complete',
    'verdict.viewMemo': 'View full memo →',
    'verdict.dismiss': 'Dismiss',
    'verdict.whatItMeans': 'What this means',
    'verdict.whatToDo': 'What to do now',
    // severity badges
    'status.critical': '⚠ Action needed',
    'status.warning': 'Watch closely',
    'status.ok': 'All clear',
    'status.proposed': 'Ready for committee',
    // recommended actions
    'action.breach': 'Notify the account officer immediately, request a compliance certificate, and prepare a waiver or amendment.',
    'action.drift': 'Contact the borrower and monitor closely. Agree on a corrective plan before {breachPeriod} — waiting risks a technical default.',
    'action.tight': 'The cushion is thin. Keep quarterly monitoring and watch the trend — a normal downside could trip the covenant.',
    'action.compliant': 'No action required. Continue routine monitoring.',
    'action.proposed': 'Take this proposal to the credit committee — every threshold is backed by the numbers.',
    // verdict headlines/details (by key)
    'v.breach.h': '{covenant} in breach',
    'v.breach.d':
      '{company} is out of compliance on at least one covenant as of {period}. Immediate lender action required.',
    'v.drift.h': 'Covenant drifting toward breach',
    'v.drift.d':
      '{covenant} is compliant today but, on the current trend, is projected to breach in {breachPeriod}{cause}.',
    'v.drift.cause': ' — driven by {cause}',
    'v.tight.h': 'Thin headroom — watch closely',
    'v.tight.d':
      '{covenant} is compliant but the cushion is thin ({headroom}). A moderate downside could trip it.',
    'v.compliant.h': 'All covenants compliant',
    'v.compliant.d': 'Every covenant is within its threshold with adequate headroom as of {period}.',
    'v.proposed.h': 'Covenant package proposed — {count} covenants',
    'v.proposed.d':
      'A {cap} sized off the worst stressed level{cushion} — every threshold derived from the numbers, not guessed.',
    'v.proposed.cushion': ', plus a volatility cushion for seasonal earnings',
    // metric labels
    'm.headroom': 'Headroom',
    'm.projectedBreach': 'Projected breach',
    'm.confidence': 'Confidence',
    'm.leverageCap': 'Leverage cap',
    'm.ebitdaVol': 'EBITDA volatility',
    'm.covenants': 'Covenants',
    // section headings
    'h.Summary': 'Summary',
    'h.Covenant compliance': 'Covenant compliance',
    'h.Drift analysis': 'Drift analysis',
    'h.Likely cause': 'Likely cause',
    'h.Forward stress': 'Forward stress',
    'h.Recommended actions': 'Recommended actions',
    'h.Appendix — definitions, data & method': 'Appendix — definitions, data & method',
    'h.Financial profile (LTM)': 'Financial profile (LTM)',
    'h.Volatility & stress evidence': 'Volatility & stress evidence',
    'h.Proposed covenant package': 'Proposed covenant package',
    'h.Recommended definitions': 'Recommended definitions',
    'h.Open items': 'Open items',
    // documents panel
    'docs.title': 'Ingested documents',
    'docs.case': 'From the case · already ingested',
    'docs.uploaded': 'Uploaded this session',
    'docs.upload': 'Upload your own document (optional)',
    'docs.drop': 'Drag a PDF or JSON financial statement',
    'docs.dropSub': 'PDF (text) or SMV-format JSON · the adapter parses and maps it to canonical fields',
    'docs.ingesting': 'Ingesting with the Peru adapter…',
    'docs.status.ingested': '✓ ingested',
    'docs.status.partial': '~ partial',
    'docs.status.failed': '✕ failed',
    // company manager
    'co.demo': 'Alimentos Andinos S.A.A. (demo case)',
    'co.ready': 'ready',
    'co.create': '+ Create new company',
    'co.modal.title': 'Create a company from your documents',
    'co.step.name': '1 · Name',
    'co.step.quarters': '2 · Quarters',
    'co.step.covenants': '3 · Covenants',
    'co.step.ready': '4 · Ready',
    'co.field.name': 'Company name',
    'co.field.create': 'Create',
    'co.field.quarters': 'Financial statements by quarter',
    'co.field.quartersReq': '(minimum 4 consecutive)',
    'co.drop': 'Drag PDF or JSON (one per quarter)',
    'co.dropSub': 'The filename or JSON must indicate the period (e.g.',
    'co.ready.quarters': 'Quarters loaded',
    'co.ready.covenants': 'Covenants defined',
    'co.ready.applyTemplate': 'apply template',
    'co.ready.yes': 'yes',
    'co.flag.before': 'Design (BEFORE)',
    'co.flag.after': 'Monitor (AFTER)',
    'co.use': 'Use this company →',
    'co.saveClose': 'Save and close',
    'co.cancel': 'Cancel',
    'co.note':
      'Verity normalizes each file to canonical fields and validates the mapping. If a file doesn’t map cleanly, it is rejected — the engine only computes on verified data, never free text.',
    // doc viewer
    'viewer.provenance': 'Provenance',
    'viewer.noSources': 'no document sources (policy-derived)',
    'viewer.loading': 'Loading document…',
  },
  es: {
    'app.tagline': 'Agente basado en documentos para diseñar y monitorear covenants de préstamos',
    'mode.before': 'Diseñar covenants · ANTES',
    'mode.after': 'Monitorear · DESPUÉS',
    'btn.run': 'Ejecutar agente',
    'btn.stop': 'Detener',
    'btn.docs': 'Documentos',
    'btn.exit': 'salir',
    'operator.guest': 'Analista invitado',
    'badge.offline': 'SIN CONEXIÓN · planificador determinista',
    'badge.retriever': 'buscador',
    'badge.loop': 'bucle',
    'step.1.title': 'Elige la pregunta',
    'step.1.hint.after': 'Monitorear un covenant existente',
    'step.1.hint.before': 'Diseñar un nuevo paquete de covenants',
    'step.2.title': 'Ejecuta el agente',
    'step.2.hint': 'Míralo planificar, buscar, calcular y decidir — en vivo',
    'step.3.title': 'Lee la respuesta',
    'step.3.hint': 'Un memo citado que puedes defender, número por número',
    'panel.trace': '① Cómo razona · en vivo',
    'panel.answer.after': '② La respuesta · memo citado',
    'panel.answer.before': '② La respuesta · propuesta de covenants',
    'trace.count': 'pasos',
    'trace.running': 'en curso',
    'empty.trace.lead': 'Observa al agente trabajar, paso a paso',
    'empty.trace.sub':
      'No es un chatbot — es un agente real. Planifica, busca en los documentos, ejecuta los cálculos y decide, en vivo. Cada paso aparece aquí para que audites exactamente cómo llegó a la respuesta.',
    'empty.cue.start': 'para empezar',
    'empty.cue.generate': 'para generarla',
    'empty.press': 'Presiona',
    'empty.answer.after.lead': 'Obtendrás un memo de escalamiento citado',
    'empty.answer.after.sub':
      'Qué covenant se está desviando, qué tan cerca del incumplimiento, cuándo se rompe, por qué — cada número enlazado a su documento fuente, con un nivel de confianza.',
    'empty.answer.before.lead': 'Obtendrás una propuesta de covenants justificada',
    'empty.answer.before.sub':
      'Qué ratios usar y qué umbral para cada uno, respaldado por volatilidad y pruebas de estrés — cada número calculado y citado, nunca adivinado.',
    'answer.composing': 'Componiendo la respuesta — las secciones aparecen aquí conforme el agente termina cada una.',
    'memo.citedFacts': 'datos citados',
    'memo.planner': 'planificador',
    'memo.loop': 'bucle',
    'memo.needsReview':
      '⚠ La confianza es BAJA en al menos un ítem — este resultado se enruta a revisión humana y no debe publicarse automáticamente.',
    'section.needsReview': 'requiere revisión',
    'draftedBy.llm': 'redactado por LLM · verificado por el guardián',
    'gate.after': 'Esta empresa necesita ≥4 trimestres consecutivos y covenants definidos para monitorear (DESPUÉS).',
    'gate.before': 'Esta empresa necesita ≥4 trimestres consecutivos para diseñar covenants (ANTES).',
    'verdict.title': 'Análisis completo',
    'verdict.viewMemo': 'Ver memo completo →',
    'verdict.dismiss': 'Cerrar',
    'verdict.whatItMeans': 'Qué significa',
    'verdict.whatToDo': 'Qué hacer ahora',
    'status.critical': '⚠ Requiere atención',
    'status.warning': 'Vigilar de cerca',
    'status.ok': 'Todo en orden',
    'status.proposed': 'Listo para comité',
    'action.breach': 'Notifica de inmediato al oficial de cuenta, solicita un certificado de cumplimiento y prepara un waiver o enmienda.',
    'action.drift': 'Contacta al prestatario y monitorea de cerca. Acuerda un plan correctivo antes de {breachPeriod} — esperar arriesga un incumplimiento técnico.',
    'action.tight': 'El colchón es delgado. Mantén el monitoreo trimestral y vigila la tendencia — una caída normal podría hacerlo incumplir.',
    'action.compliant': 'Sin acción requerida. Continúa el monitoreo de rutina.',
    'action.proposed': 'Lleva esta propuesta al comité de crédito — cada umbral está respaldado por los números.',
    'v.breach.h': '{covenant} incumplido',
    'v.breach.d':
      '{company} está fuera de cumplimiento en al menos un covenant al {period}. Se requiere acción inmediata del prestamista.',
    'v.drift.h': 'Covenant desviándose hacia el incumplimiento',
    'v.drift.d':
      '{covenant} cumple hoy pero, en la tendencia actual, se proyecta incumplir en {breachPeriod}{cause}.',
    'v.drift.cause': ' — impulsado por {cause}',
    'v.tight.h': 'Holgura mínima — vigilar de cerca',
    'v.tight.d':
      '{covenant} cumple pero el colchón es delgado ({headroom}). Una caída moderada podría hacerlo incumplir.',
    'v.compliant.h': 'Todos los covenants cumplen',
    'v.compliant.d': 'Cada covenant está dentro de su umbral con holgura adecuada al {period}.',
    'v.proposed.h': 'Paquete de covenants propuesto — {count} covenants',
    'v.proposed.d':
      'Un {cap} dimensionado sobre el peor escenario estresado{cushion} — cada umbral derivado de los números, no adivinado.',
    'v.proposed.cushion': ', más un colchón de volatilidad para ganancias estacionales',
    'm.headroom': 'Holgura',
    'm.projectedBreach': 'Incumplimiento proyectado',
    'm.confidence': 'Confianza',
    'm.leverageCap': 'Tope apalancamiento',
    'm.ebitdaVol': 'Volatilidad EBITDA',
    'm.covenants': 'Covenants',
    'h.Summary': 'Resumen',
    'h.Covenant compliance': 'Cumplimiento de covenants',
    'h.Drift analysis': 'Análisis de desvío',
    'h.Likely cause': 'Causa probable',
    'h.Forward stress': 'Estrés prospectivo',
    'h.Recommended actions': 'Acciones recomendadas',
    'h.Appendix — definitions, data & method': 'Apéndice — definiciones, datos y método',
    'h.Financial profile (LTM)': 'Perfil financiero (UDM)',
    'h.Volatility & stress evidence': 'Evidencia de volatilidad y estrés',
    'h.Proposed covenant package': 'Paquete de covenants propuesto',
    'h.Recommended definitions': 'Definiciones recomendadas',
    'h.Open items': 'Puntos pendientes',
    'docs.title': 'Documentos ingeridos',
    'docs.case': 'Del caso · ya ingeridos',
    'docs.uploaded': 'Subidos en esta sesión',
    'docs.upload': 'Sube tu propio documento (opcional)',
    'docs.drop': 'Arrastra un PDF o JSON de estados financieros',
    'docs.dropSub': 'PDF (texto) o JSON con formato SMV · el adaptador lo parsea y mapea a campos canónicos',
    'docs.ingesting': 'Ingiriendo con el adaptador de Perú…',
    'docs.status.ingested': '✓ ingerido',
    'docs.status.partial': '~ parcial',
    'docs.status.failed': '✕ fallido',
    'co.demo': 'Alimentos Andinos S.A.A. (caso demo)',
    'co.ready': 'listo',
    'co.create': '+ Crear empresa nueva',
    'co.modal.title': 'Crear empresa desde tus documentos',
    'co.step.name': '1 · Nombre',
    'co.step.quarters': '2 · Trimestres',
    'co.step.covenants': '3 · Covenants',
    'co.step.ready': '4 · Listo',
    'co.field.name': 'Nombre de la empresa',
    'co.field.create': 'Crear',
    'co.field.quarters': 'Estados financieros por trimestre',
    'co.field.quartersReq': '(mínimo 4 consecutivos)',
    'co.drop': 'Arrastra PDF o JSON (uno por trimestre)',
    'co.dropSub': 'El nombre del archivo o el JSON deben indicar el período (p. ej.',
    'co.ready.quarters': 'Trimestres cargados',
    'co.ready.covenants': 'Covenants definidos',
    'co.ready.applyTemplate': 'aplicar plantilla',
    'co.ready.yes': 'sí',
    'co.flag.before': 'Diseñar (ANTES)',
    'co.flag.after': 'Monitorear (DESPUÉS)',
    'co.use': 'Usar esta empresa →',
    'co.saveClose': 'Guardar y cerrar',
    'co.cancel': 'Cancelar',
    'co.note':
      'Verity normaliza cada archivo a campos canónicos y valida el mapeo. Si un archivo no mapea limpio, se rechaza — el motor solo calcula sobre datos verificados, nunca sobre texto libre.',
    'viewer.provenance': 'Procedencia',
    'viewer.noSources': 'sin fuentes documentales (derivado de política)',
    'viewer.loading': 'Cargando documento…',
  },
  fr: {
    'app.tagline': 'Agent basé sur documents pour concevoir et surveiller les covenants de prêts',
    'mode.before': 'Concevoir · AVANT',
    'mode.after': 'Surveiller · APRÈS',
    'btn.run': 'Lancer l’agent',
    'btn.stop': 'Arrêter',
    'btn.docs': 'Documents',
    'btn.exit': 'sortir',
    'operator.guest': 'Analyste invité',
    'badge.offline': 'HORS LIGNE · planificateur déterministe',
    'badge.retriever': 'recherche',
    'badge.loop': 'boucle',
    'step.1.title': 'Choisissez la question',
    'step.1.hint.after': 'Surveiller un covenant existant',
    'step.1.hint.before': 'Concevoir un nouveau paquet de covenants',
    'step.2.title': 'Lancez l’agent',
    'step.2.hint': 'Regardez-le planifier, rechercher, calculer et décider — en direct',
    'step.3.title': 'Lisez la réponse',
    'step.3.hint': 'Un mémo cité que vous pouvez défendre, chiffre par chiffre',
    'panel.trace': '① Comment il raisonne · en direct',
    'panel.answer.after': '② La réponse · mémo cité',
    'panel.answer.before': '② La réponse · proposition de covenants',
    'trace.count': 'étapes',
    'trace.running': 'en cours',
    'empty.trace.lead': 'Regardez l’agent travailler, étape par étape',
    'empty.trace.sub':
      'Pas un chatbot — un vrai agent. Il planifie, cherche dans les documents, exécute les calculs et décide, en direct. Chaque étape apparaît ici pour auditer exactement comment il est arrivé à la réponse.',
    'empty.cue.start': 'pour commencer',
    'empty.cue.generate': 'pour la générer',
    'empty.press': 'Appuyez sur',
    'empty.answer.after.lead': 'Vous obtiendrez un mémo d’escalade cité',
    'empty.answer.after.sub':
      'Quel covenant dérive, à quel point proche du défaut, quand il rompt, pourquoi — chaque chiffre lié à son document source, avec un niveau de confiance.',
    'empty.answer.before.lead': 'Vous obtiendrez une proposition de covenants justifiée',
    'empty.answer.before.sub':
      'Quels ratios utiliser et quel seuil pour chacun, appuyés par la volatilité et les tests de résistance — chaque chiffre calculé et cité, jamais deviné.',
    'answer.composing': 'Composition de la réponse — les sections apparaissent ici à mesure que l’agent les termine.',
    'memo.citedFacts': 'faits cités',
    'memo.planner': 'planificateur',
    'memo.loop': 'boucle',
    'memo.needsReview':
      '⚠ La confiance est FAIBLE sur au moins un élément — ce résultat est acheminé vers une révision humaine et ne doit pas être publié automatiquement.',
    'section.needsReview': 'à réviser',
    'draftedBy.llm': 'rédigé par LLM · vérifié par le garde',
    'gate.after': 'Cette entreprise a besoin de ≥4 trimestres consécutifs et de covenants définis pour surveiller (APRÈS).',
    'gate.before': 'Cette entreprise a besoin de ≥4 trimestres consécutifs pour concevoir des covenants (AVANT).',
    'verdict.title': 'Analyse terminée',
    'verdict.viewMemo': 'Voir le mémo complet →',
    'verdict.dismiss': 'Fermer',
    'verdict.whatItMeans': 'Ce que cela signifie',
    'verdict.whatToDo': 'Que faire maintenant',
    'status.critical': '⚠ Action requise',
    'status.warning': 'À surveiller de près',
    'status.ok': 'Tout est en ordre',
    'status.proposed': 'Prêt pour le comité',
    'action.breach': 'Prévenez immédiatement le chargé de compte, demandez un certificat de conformité et préparez une dérogation ou un amendement.',
    'action.drift': 'Contactez l’emprunteur et surveillez de près. Convenez d’un plan correctif avant {breachPeriod} — attendre risque un défaut technique.',
    'action.tight': 'Le coussin est mince. Maintenez le suivi trimestriel et surveillez la tendance — une baisse normale pourrait rompre le covenant.',
    'action.compliant': 'Aucune action requise. Poursuivez le suivi de routine.',
    'action.proposed': 'Présentez cette proposition au comité de crédit — chaque seuil est appuyé par les chiffres.',
    'v.breach.h': '{covenant} en défaut',
    'v.breach.d':
      '{company} n’est pas en conformité sur au moins un covenant au {period}. Action immédiate du prêteur requise.',
    'v.drift.h': 'Covenant dérivant vers le défaut',
    'v.drift.d':
      '{covenant} est conforme aujourd’hui mais, sur la tendance actuelle, devrait rompre en {breachPeriod}{cause}.',
    'v.drift.cause': ' — dû à {cause}',
    'v.tight.h': 'Marge mince — surveiller de près',
    'v.tight.d':
      '{covenant} est conforme mais le coussin est mince ({headroom}). Une baisse modérée pourrait le faire rompre.',
    'v.compliant.h': 'Tous les covenants conformes',
    'v.compliant.d': 'Chaque covenant est dans son seuil avec une marge adéquate au {period}.',
    'v.proposed.h': 'Paquet de covenants proposé — {count} covenants',
    'v.proposed.d':
      'Un {cap} dimensionné sur le pire scénario de stress{cushion} — chaque seuil dérivé des chiffres, pas deviné.',
    'v.proposed.cushion': ', plus un coussin de volatilité pour les bénéfices saisonniers',
    'm.headroom': 'Marge',
    'm.projectedBreach': 'Défaut projeté',
    'm.confidence': 'Confiance',
    'm.leverageCap': 'Plafond levier',
    'm.ebitdaVol': 'Volatilité EBITDA',
    'm.covenants': 'Covenants',
    'h.Summary': 'Résumé',
    'h.Covenant compliance': 'Conformité des covenants',
    'h.Drift analysis': 'Analyse de dérive',
    'h.Likely cause': 'Cause probable',
    'h.Forward stress': 'Stress prospectif',
    'h.Recommended actions': 'Actions recommandées',
    'h.Appendix — definitions, data & method': 'Annexe — définitions, données et méthode',
    'h.Financial profile (LTM)': 'Profil financier (12 mois)',
    'h.Volatility & stress evidence': 'Preuves de volatilité et de stress',
    'h.Proposed covenant package': 'Paquet de covenants proposé',
    'h.Recommended definitions': 'Définitions recommandées',
    'h.Open items': 'Points en suspens',
    'docs.title': 'Documents ingérés',
    'docs.case': 'Du cas · déjà ingérés',
    'docs.uploaded': 'Téléversés cette session',
    'docs.upload': 'Téléversez votre propre document (facultatif)',
    'docs.drop': 'Glissez un PDF ou JSON d’états financiers',
    'docs.dropSub': 'PDF (texte) ou JSON format SMV · l’adaptateur l’analyse et le mappe aux champs canoniques',
    'docs.ingesting': 'Ingestion avec l’adaptateur du Pérou…',
    'docs.status.ingested': '✓ ingéré',
    'docs.status.partial': '~ partiel',
    'docs.status.failed': '✕ échoué',
    'co.demo': 'Alimentos Andinos S.A.A. (cas démo)',
    'co.ready': 'prêt',
    'co.create': '+ Créer une entreprise',
    'co.modal.title': 'Créer une entreprise à partir de vos documents',
    'co.step.name': '1 · Nom',
    'co.step.quarters': '2 · Trimestres',
    'co.step.covenants': '3 · Covenants',
    'co.step.ready': '4 · Prêt',
    'co.field.name': 'Nom de l’entreprise',
    'co.field.create': 'Créer',
    'co.field.quarters': 'États financiers par trimestre',
    'co.field.quartersReq': '(minimum 4 consécutifs)',
    'co.drop': 'Glissez PDF ou JSON (un par trimestre)',
    'co.dropSub': 'Le nom du fichier ou le JSON doit indiquer la période (p. ex.',
    'co.ready.quarters': 'Trimestres chargés',
    'co.ready.covenants': 'Covenants définis',
    'co.ready.applyTemplate': 'appliquer le modèle',
    'co.ready.yes': 'oui',
    'co.flag.before': 'Concevoir (AVANT)',
    'co.flag.after': 'Surveiller (APRÈS)',
    'co.use': 'Utiliser cette entreprise →',
    'co.saveClose': 'Enregistrer et fermer',
    'co.cancel': 'Annuler',
    'co.note':
      'Verity normalise chaque fichier en champs canoniques et valide le mappage. Si un fichier ne mappe pas proprement, il est rejeté — le moteur ne calcule que sur des données vérifiées, jamais du texte libre.',
    'viewer.provenance': 'Provenance',
    'viewer.noSources': 'aucune source documentaire (dérivé de politique)',
    'viewer.loading': 'Chargement du document…',
  },
};

type Translate = (key: string, params?: Record<string, string | number>) => string;

const I18nContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: Translate } | null>(null);

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('es');

  useEffect(() => {
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('verity-lang')) as Lang | null;
    if (saved && (saved === 'es' || saved === 'en' || saved === 'fr')) setLangState(saved);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('verity-lang', l);
    } catch {
      /* ignore */
    }
  }, []);

  const t: Translate = useCallback(
    (key, params) => {
      const table = DICT[lang];
      const val = table[key] ?? DICT.en[key] ?? key;
      return interpolate(val, params);
    },
    [lang],
  );

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
