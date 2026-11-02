// Regulatory alleles drive fields and production rules in development.js.
// Each regulator can affect several organs; topology is an output of growth.
export const GROUPS = [
  ['Axial patterning', [
    ['axialGrowth', 'Axial growth', .48, 'Extension of every axial bud; shares a finite growth budget with the limbs.'],
    ['segmentationClock', 'Segmentation clock', .27, 'Number of axial segments and rhythm of appendage induction.'],
    ['segmentPolarity', 'Segment polarity', .23, 'Alternating segment expansion and pigment boundaries.'],
    ['radialPattern', 'Axis duplication', .16, 'Induces additional body axes around the primary axis.'],
    ['axialCurl', 'Axis curvature', .57, 'Curves the axial field and redirects daughter buds.'],
    ['torsionGradient', 'Torsion gradient', .44, 'Twists the body frame, organ sites, and fin orientation together.'],
    ['dorsalGradient', 'Dorsal organizer', .67, 'Dorsal expansion and the competence of dorsal organ sites.'],
    ['ventralGradient', 'Ventral organizer', .36, 'Ventral expansion and limb-bud direction.'],
    ['growthFeedback', 'Growth feedback', .55, 'Suppresses nearby growth, separating segments and repeated organs.'],
    ['symmetryBreak', 'Symmetry breaking', .28, 'Breaks bilateral coupling in axes, organs, and appendages.'],
  ]],
  ['Terminal fields', [
    ['organizerStrength', 'Organizer strength', .68, 'Size and competence of terminal organizers at axial tips.'],
    ['organizerDuplication', 'Organizer duplication', .25, 'Releases secondary terminal organizers on daughter axes.'],
    ['organizerMigration', 'Organizer migration', .32, 'Moves organizers inward along the axes, moving associated sensory sites.'],
    ['fieldFusion', 'Field fusion', .82, 'Fuses a growth field into solid tissue; low values leave open shells and ribbons.'],
    ['crestActivation', 'Crest activation', .85, 'Paired crown ridges arise from growth around a central inhibition field.'],
    ['budCompetition', 'Bud competition', .55, 'Competition between neighboring terminal buds changes their thickness and retained tissue.'],
    ['terminalInduction', 'Terminal repetition', .32, 'Repeats folds around each terminal organizer.'],
    ['terminalBranching', 'Terminal branching', .27, 'Bifurcates the free ends of terminal growth loops.'],
    ['terminalCurl', 'Terminal curvature', .48, 'Bends growth loops and their descendants through the terminal field.'],
    ['ridgeInduction', 'Crown induction', .37, 'Extends terminal sensory filaments out of the folded growths.'],
  ]],
  ['Appendage grammar', [
    ['limbInduction', 'Limb competence', .66, 'Threshold for appendage buds on competent axial segments.'],
    ['limbSpacing', 'Lateral inhibition', .35, 'Controls the number and spacing of appendage sites.'],
    ['limbPhase', 'Induction phase', .39, 'Shifts appendage sites relative to the segmentation clock.'],
    ['limbBranching', 'Branch activation', .24, 'Releases daughter limbs at distal branching points.'],
    ['limbRecursion', 'Branch recurrence', .21, 'Allows branches to repeat their own growth rule.'],
    ['proximalGrowth', 'Proximal extension', .54, 'Extension of the first segment of each appendage.'],
    ['distalGrowth', 'Distal extension', .69, 'Extension of daughter segments and the membrane between them.'],
    ['digitInduction', 'Terminal repetition', .67, 'Number of terminal digits produced by each branch tip.'],
    ['digitBranching', 'Terminal bifurcation', .36, 'Divides terminal digits into smaller daughter filaments.'],
    ['webbing', 'Membrane retention', .19, 'Retains tissue between neighboring digits, producing sails.'],
    ['jointBias', 'Articulation bias', .48, 'Bends successive limb segments in alternating directions.'],
    ['symmetryCoupling', 'Bilateral coupling', .79, 'Couples the induction field across the left and right sides.'],
  ]],
  ['Caudal grammar', [
    ['tailInduction', 'Caudal competence', .19, 'Number of tail buds at the posterior organizer.'],
    ['tailBranching', 'Caudal bifurcation', .28, 'Releases paired daughter branches from a growing tail.'],
    ['tailRecursion', 'Caudal recurrence', .21, 'Lets tail daughters produce another branching generation.'],
    ['tailGrowth', 'Caudal extension', .66, 'Tail growth, limited by the shared resource field.'],
    ['tailCurl', 'Caudal curvature', .63, 'Curl accumulates along a tail and is inherited by its descendants.'],
    ['tailTorsion', 'Caudal torsion', .45, 'Rotates tail branching planes through space.'],
    ['terminalBud', 'Terminal differentiation', .26, 'Differentiates tail ends into terminal growths.'],
    ['caudalWave', 'Caudal wave', .66, 'Phase of the growing tail and its mature undulation.'],
  ]],
  ['Sensory field', [
    ['eyeMigration', 'Ocular migration', .92, 'Distributes a fixed budget of nine eyes across terminal and axial surfaces.'],
    ['eyeClustering', 'Ocular inhibition', .61, 'Repels nearby ocular sites and spreads eyes across different organizers.'],
    ['eyePolarity', 'Ocular polarity', .64, 'Biases ocular selection towards dorsal or lateral surfaces.'],
    ['eyeStalk', 'Peduncle induction', .12, 'Raises eye buds on curved sensory stalks.'],
    ['eyeScale', 'Ocular investment', .5, 'Resource investment per eye and its stalk.'],
    ['eyeRhythm', 'Ocular phase', .47, 'Shifts the ocular induction field relative to axial segments.'],
    ['retinalPigment', 'Retinal pigment', .12, 'Pigment in the nine iris organs.'],
    ['pupilResponse', 'Pupil response', .32, 'Changes the pupil aperture and light reflex.'],
    ['antennaInduction', 'Filament competence', .35, 'Growth of sensory filaments on the node and dorsal field.'],
    ['antennaBranching', 'Filament bifurcation', .55, 'Splits sensory filaments at their tips.'],
  ]],
  ['Integument field', [
    ['pigmentActivator', 'Pigment activation', .58, 'Wavelength of the pigment field; interacts with inhibition and axial segmentation.'],
    ['pigmentInhibitor', 'Pigment inhibition', .6, 'Suppresses activated pigment and changes stripes into islands.'],
    ['pigmentDiffusion', 'Pigment diffusion', .38, 'Curves and mixes the two pigment fields across the skin.'],
    ['pigmentThreshold', 'Pigment threshold', .54, 'Threshold for dark pigment and luminous spots.'],
    ['pigmentHue', 'Pigment family', .09, 'Shared pigment family of body, membranes, and sensory filaments.'],
    ['pigmentChroma', 'Pigment saturation', .26, 'Concentration of skin and membrane pigment.'],
    ['dermalGrowth', 'Dermal outgrowth', .24, 'Differentiates smooth tissue, plates, and short dermal fibers.'],
    ['spineInduction', 'Dorsal spines', .22, 'Releases recurrent spine buds on competent dorsal segments.'],
    ['photophoreInduction', 'Luminous organs', .20, 'Induces luminous organs on segments and branch tips.'],
  ]],
  ['Growth & reflexes', [
    ['growthRate', 'Developmental rate', .58, 'Growth velocity and timing of organ differentiation.'],
    ['resourceBias', 'Resource partition', .52, 'Divides a bounded tissue budget between axial and lateral growth.'],
    ['elasticity', 'Tissue compliance', .63, 'Membrane sag and mature flexibility of every branch.'],
    ['respiration', 'Metabolic rhythm', .46, 'Respiratory expansion and rhythm of luminous organs.'],
    ['reflexGain', 'Flight reflex', .62, 'Appendage folding and node response during banking and burst.'],
    ['ciliaMotion', 'Filament motion', .51, 'Movement of sensory filaments and distal appendages.'],
    ['luminousResponse', 'Luminous response', .62, 'Pulse amplitude of photophores, eye organs, and tail seeds.'],
    ['phaseCoupling', 'Oscillator coupling', .68, 'Couples the undulation of neighboring axial segments and appendages.'],
  ]],
];
export const DEFINITIONS=GROUPS.flatMap(([,rows])=>rows);
export const DEFAULT_GENES=Object.fromEntries(DEFINITIONS.map(([key,,value])=>[key,value]));
if(DEFINITIONS.length!==67||new Set(DEFINITIONS.map(([k])=>k)).size!==67)throw Error('Expected 67 unique regulatory alleles.');
export const GENOME_VERSION=2;
const clamp=n=>Math.max(0,Math.min(1,n));
export function random(seed){let n=seed>>>0;return()=>{n+=0x6D2B79F5;let t=n;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
export function spawnGenes(seed){
  const rng=random(seed),genes={};
  // Founders sample the whole allele space. They are not small perturbations of
  // one default specimen. Shared module polarity preserves coupled expression.
  for(const [,rows] of GROUPS){
    const polarity=rng()<.5?-1:1;
    for(const [key] of rows){const u=rng();genes[key]=clamp(u+polarity*.12*Math.sin(u*Math.PI));}
  }
  // Independent high-leverage field switches keep silhouettes from converging
  // on the same middle-of-range branching grammar.
  for(const key of ['axialGrowth','radialPattern','fieldFusion','resourceBias','webbing','limbSpacing','organizerDuplication','axialCurl'])genes[key]=rng();
  return genes;
}
export function mutateGenes(parent,seed){
  const rng=random(seed),group=GROUPS[Math.floor(rng()*GROUPS.length)],genes={...parent};
  const candidates=[...group[1]];let changes=2+Math.floor(rng()*4);
  while(changes--&&candidates.length){const i=Math.floor(rng()*candidates.length),[key]=candidates.splice(i,1)[0];genes[key]=clamp(genes[key]+(rng()<.5?-1:1)*(.09+rng()*.27));}
  return {genes,module:group[0]};
}
export function crossGenes(a,b,seed){
  const rng=random(seed),genes={};let fromA=rng()<.5;
  for(const [,rows] of GROUPS){if(rng()<.55)fromA=!fromA;for(const [key] of rows)genes[key]=(fromA?a:b)[key];}
  return genes;
}
export const PRESETS={
  mantle:{...DEFAULT_GENES},
  spindle:{...DEFAULT_GENES,radialPattern:.48,axialGrowth:.95,segmentationClock:.51,axialCurl:.83,organizerDuplication:.12,limbSpacing:.12,limbInduction:.53,fieldFusion:.35,resourceBias:.89,webbing:.92,tailInduction:.18,tailRecursion:.29,eyeMigration:.93,eyeStalk:.15,dermalGrowth:.12,spineInduction:.26,pigmentHue:.58},
  corolla:{...DEFAULT_GENES,radialPattern:.94,axialGrowth:.18,segmentationClock:.31,organizerDuplication:.77,organizerMigration:.12,limbSpacing:.27,limbInduction:.79,webbing:.75,fieldFusion:.67,resourceBias:.12,tailInduction:.46,tailBranching:.34,eyeMigration:.49,eyeClustering:.93,eyeStalk:.18,pigmentHue:.81,pigmentChroma:.65},
};
export function validateGenome(data){
  if(data?.version!==GENOME_VERSION||data?.eyes!==9||!Number.isSafeInteger(data.seed)||!data.genes||Object.keys(data.genes).length!==67)throw Error('Expected a developmental genome (v2), 67 regulators, and nine eyes.');
  for(const [key] of DEFINITIONS)if(!Number.isFinite(data.genes[key])||data.genes[key]<0||data.genes[key]>1)throw Error('Invalid regulator: '+key);
  return Object.fromEntries(DEFINITIONS.map(([key])=>[key,data.genes[key]]));
}
