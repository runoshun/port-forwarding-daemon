export const install_deno_cmd = (DENO_INSTALL_PATH: string) => {
  return [
    `if [ ! -e ${DENO_INSTALL_PATH}/bin/deno ]; then`,
    `export DENO_INSTALL=${DENO_INSTALL_PATH} &&`,
    `curl -fsSL https://deno.land/install.sh | sh; `,
    `fi`,
  ].join(" ");
};
