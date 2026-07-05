import type { SourceDocument } from '@covenant/core';
import { COMPANY, SEED_CONSTANTS, type BuiltQuarter } from './seed';
import { filingDocIdFor } from './buildSmv';

const n = (value: number): string => Math.round(value).toLocaleString('en-US');

/** Human-readable quarterly filings (Spanish, NIIF layout) rendered from the
 *  same seed the SMV fixtures use — the citation viewer shows these. */
export function renderFilingDocuments(quarters: BuiltQuarter[]): SourceDocument[] {
  return quarters.map((q) => {
    const notas: string[] = [
      `Nota 1 — Obligaciones financieras. Al cierre del período la deuda financiera comprende: línea revolvente por S/ ${n(q.revolver)} mil (BCP e Interbank), préstamo sindicado con vencimiento 2027 por S/ ${n(q.cpltd + q.ltd)} mil (porción corriente S/ ${n(q.cpltd)} mil) y pasivos por arrendamiento (NIIF 16) por S/ ${n(q.leasesTotal)} mil. Aproximadamente el ${Math.round(SEED_CONSTANTS.floatingRateDebtShare * 100)}% de la deuda financiera devenga tasa variable referenciada.`,
      `Nota 2 — Arrendamientos (NIIF 16). Los pasivos por arrendamiento se reconocen conforme a la NIIF 16; la porción corriente asciende a S/ ${n(q.leaseCurrent)} mil y la no corriente a S/ ${n(q.leaseNonCurrent)} mil. Los pagos de principal del período fueron S/ ${n(q.leasePrincipal)} mil.`,
    ];
    if (q.seed.leaseFinanced > 0) {
      notas.push(
        `Nota 3 — Adiciones de activos por derecho de uso. Durante el trimestre se incorporaron activos por arrendamiento por S/ ${n(q.seed.leaseFinanced)} mil (adición no monetaria).`,
      );
    }
    if (q.seed.dividends > 0) {
      notas.push(
        `Nota 4 — Distribuciones. La Junta General acordó una distribución a accionistas por S/ ${n(q.seed.dividends)} mil, pagada el ${q.seed.dividendDate ?? 'trimestre'}.`,
      );
    }
    if (q.seed.oneTime) {
      notas.push(
        `Nota 5 — Partidas no recurrentes. El resultado operativo incluye S/ ${n(q.seed.oneTime.amount)} mil por «${q.seed.oneTime.label}», que la Gerencia considera de naturaleza no recurrente.`,
      );
    }

    return {
      id: filingDocIdFor(q.label),
      title: `Estados Financieros Intermedios ${q.label} — ${COMPANY.name}`,
      kind: 'filing' as const,
      language: 'es' as const,
      period: q.label,
      date: q.filedAt,
      sections: [
        {
          id: 'portada',
          title: 'Portada',
          text: `${COMPANY.name} (RMV ${COMPANY.rmvCode}, ticker ${COMPANY.ticker}). Información financiera intermedia al ${q.endDate}, presentada a la SMV el ${q.filedAt}. Cifras en miles de soles (S/ 000). Preparada de acuerdo con las NIIF. DOCUMENTO ILUSTRATIVO GENERADO PARA DEMOSTRACIÓN.`,
        },
        {
          id: 'estado-situacion',
          title: 'Estado de Situación Financiera',
          text: [
            `Efectivo y Equivalentes al Efectivo          ${n(q.cash)}`,
            `Cuentas por Cobrar Comerciales               ${n(q.ar)}`,
            `Inventarios                                  ${n(q.inventory)}`,
            `Otros Activos Corrientes                     ${n(SEED_CONSTANTS.otherCurrentAssets)}`,
            `Total Activos Corrientes                     ${n(q.currentAssets)}`,
            `Propiedades, Planta y Equipo                 ${n(q.ppe)}`,
            `Activos por Derecho de Uso                   ${n(q.rou)}`,
            `Otros Activos No Corrientes                  ${n(SEED_CONSTANTS.otherNonCurrentAssets)}`,
            `Total Activos                                ${n(q.totalAssets)}`,
            `Otros Pasivos Financieros Corrientes         ${n(q.revolver)}`,
            `Porción Corriente de Deuda a Largo Plazo     ${n(q.cpltd)}`,
            `Pasivos por Arrendamiento Corrientes         ${n(q.leaseCurrent)}`,
            `Cuentas por Pagar Comerciales                ${n(q.ap)}`,
            `Otros Pasivos Corrientes                     ${n(SEED_CONSTANTS.otherCurrentLiabilities)}`,
            `Total Pasivos Corrientes                     ${n(q.currentLiabilities)}`,
            `Otros Pasivos Financieros No Corrientes      ${n(q.ltd)}`,
            `Pasivos por Arrendamiento No Corrientes      ${n(q.leaseNonCurrent)}`,
            `Otros Pasivos No Corrientes                  ${n(SEED_CONSTANTS.otherNonCurrentLiabilities)}`,
            `Total Pasivos                                ${n(q.totalLiabilities)}`,
            `Total Patrimonio                             ${n(q.equity)}`,
          ].join('\n'),
        },
        {
          id: 'estado-resultados',
          title: 'Estado de Resultados',
          text: [
            `Ingresos de Actividades Ordinarias           ${n(q.revenue)}`,
            `Ganancia (Pérdida) por Actividades de Operación   ${n(q.operatingProfit)}`,
            `Gastos Financieros                           (${n(q.interest)})`,
            `Gasto por Impuesto a las Ganancias           (${n(q.tax)})`,
            `Ganancia (Pérdida) Neta del Ejercicio        ${n(q.netIncome)}`,
            `Compensación Basada en Acciones              ${n(q.stockComp)}`,
          ].join('\n'),
        },
        {
          id: 'estado-flujos',
          title: 'Estado de Flujos de Efectivo',
          text: [
            `Depreciación y Amortización                  ${n(q.da)}`,
            `Impuestos a las Ganancias Pagados            (${n(q.cashTaxesPaid)})`,
            `Intereses Pagados                            (${n(q.cashInterestPaid)})`,
            `Flujo de Efectivo de Actividades de Operación     ${n(q.cfo)}`,
            `Compra de Propiedades, Planta y Equipo       (${n(q.seed.capexGross)})`,
            `Amortización de Préstamos                    (${n(q.termAmort)})`,
            `Pagos de Pasivos por Arrendamiento           (${n(q.leasePrincipal)})`,
            ...(q.seed.dividends > 0 ? [`Dividendos Pagados                           (${n(q.seed.dividends)})`] : []),
            ...(q.seed.leaseFinanced > 0
              ? [`Adiciones por Arrendamientos (No Efectivo)   ${n(q.seed.leaseFinanced)}`]
              : []),
            `Aumento (Disminución) Neto de Efectivo       ${n(q.cfo + q.cfi + q.cff)}`,
          ].join('\n'),
        },
        {
          id: 'notas',
          title: 'Notas a los Estados Financieros',
          text: notas.join('\n\n'),
        },
      ],
    };
  });
}
