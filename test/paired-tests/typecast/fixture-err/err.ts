const x = { a: 1 } as object;

const y = <object>{ b: 2 };

const z = (array: (string | null)[]): string[] => {
  return array.filter((v) => !!v) as string[];
};
z([null, '', 'str']);
