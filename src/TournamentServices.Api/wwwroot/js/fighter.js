const palette = {
  k: '#1a0f2e',
  m: '#ff8a3d',
  w: '#fff4e6',
  e: '#1a0f2e',
  o: '#ff5e3a',
  j: '#19b3a6',
  J: '#0f7f76',
  g: '#ffd23f',
  p: '#3b2d6b',
  b: '#1a0f2e',
};

const sprite = [
  '....k......k....',
  '...kmk....kmk...',
  '...kmmkkkkmmk...',
  '...kmmmmmmmmk...',
  '..kmwwmmmmwwmk..',
  '..kmwekmmkewmk..',
  '..kmwwwmmwwwmk..',
  '...kmwwwwwwmk...',
  '....kkwwwwkk....',
  '...koooooooook..',
  '..kjjjoojjjjjk..',
  '.kgkjjjojjjjkgk.',
  '.kggkjjojjjkggk.',
  '..kkkjJJJJjkkk..',
  '....kjjjjjjk....',
  '....kppppppk....',
  '....kppkkppk....',
  '....kppk.kppk...',
  '...kbbbk.kbbbk..',
  '...kkkkk.kkkkk..',
];

// Se dibuja con rectángulos SVG en lugar de una imagen para que escale sin perder los pixeles.
export function createFighter(className = 'fighter') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${sprite[0].length} ${sprite.length}`);
  svg.setAttribute('class', className);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');

  sprite.forEach((row, y) => {
    [...row].forEach((cell, x) => {
      const color = palette[cell];
      if (!color) return;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', 1);
      rect.setAttribute('height', 1);
      rect.setAttribute('fill', color);
      svg.append(rect);
    });
  });
  return svg;
}
