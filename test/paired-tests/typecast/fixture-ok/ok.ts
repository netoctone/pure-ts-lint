const x = { a: 1 } as const;
const y = <const>{ b: 2 };

const z = (array: (string | null)[]): string[] => {
  return array.filter(v => v !== null).filter((v) => !!v);
};
z([null, '', 'str']);
