// Tabela admin com busca, filtro, ordenacao por coluna e paginacao — tudo
// no navegador, sem round-trip ao servidor. Feito pra listas de tamanho
// modesto (dezenas/poucas centenas de linhas, como os posts do blog), onde
// buscar tudo de uma vez e deixar o JS filtrar/ordenar/paginar e mais
// simples e mais rapido pro usuario do que reconstruir a pagina a cada
// clique — sem puxar nenhuma dependencia (jQuery, DataTables etc.) so pra
// isso.
//
// Uso: um wrapper com [data-admin-table] contendo uma <table> cujo <tbody>
// tem uma linha por registro ([data-row], com data-status e data-search
// opcionais) e, dentro de cada <td> ordenavel, data-col="chave" e
// data-value="valor bruto pra comparar" (numero pra colunas numericas/data,
// string em minusculo pras demais). Cabecalhos ordenaveis sao
// <button data-sort="chave"><i class="fa-solid fa-sort"></i></button>.
// Controles opcionais dentro do wrapper: [data-table-search] (input),
// [data-table-filter="status"] (select), [data-table-page-size] (select,
// 0 = todos), [data-table-info] (paragrafo de contagem),
// [data-table-pager] (<ul> de paginacao) e uma <tr data-table-empty hidden>
// pro estado "nada encontrado".
(function () {
    'use strict';

    function normalize(value) {
        return (value || '')
            .toString()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    function initAdminTable(root) {
        var table = root.querySelector('table');

        if (!table) {
            return;
        }

        var tbody = table.querySelector('tbody');
        var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr[data-row]'));
        var searchInput = root.querySelector('[data-table-search]');
        var statusSelect = root.querySelector('[data-table-filter="status"]');
        var pageSizeSelect = root.querySelector('[data-table-page-size]');
        var infoEl = root.querySelector('[data-table-info]');
        var pagerEl = root.querySelector('[data-table-pager]');
        var emptyRow = root.querySelector('[data-table-empty]');
        var sortButtons = Array.prototype.slice.call(root.querySelectorAll('[data-sort]'));

        var state = {
            search: '',
            status: '',
            sortKey: root.getAttribute('data-default-sort') || null,
            sortDir: parseInt(root.getAttribute('data-default-dir'), 10) || 1,
            page: 1,
            pageSize: pageSizeSelect ? parseInt(pageSizeSelect.value, 10) : 10
        };

        function matches(row) {
            if (state.status !== '' && row.getAttribute('data-status') !== state.status) {
                return false;
            }

            if (state.search === '') {
                return true;
            }

            return normalize(row.getAttribute('data-search')).indexOf(state.search) !== -1;
        }

        var sortTypes = {};

        sortButtons.forEach(function (button) {
            sortTypes[button.getAttribute('data-sort')] = button.getAttribute('data-sort-type') || 'text';
        });

        function sortValue(row, key) {
            var cell = row.querySelector('td[data-col="' + key + '"]');

            return cell ? cell.getAttribute('data-value') || '' : '';
        }

        function sortRows(list) {
            if (!state.sortKey) {
                return list;
            }

            var key = state.sortKey;
            var dir = state.sortDir;
            var isNumeric = sortTypes[key] === 'number';

            return list.slice().sort(function (a, b) {
                var av = sortValue(a, key);
                var bv = sortValue(b, key);

                if (isNumeric) {
                    return ((parseFloat(av) || 0) - (parseFloat(bv) || 0)) * dir;
                }

                return av.localeCompare(bv, 'pt-BR') * dir;
            });
        }

        function updateSortIcons() {
            sortButtons.forEach(function (button) {
                var icon = button.querySelector('i');

                if (!icon) {
                    return;
                }

                if (button.getAttribute('data-sort') === state.sortKey) {
                    icon.className = 'fa-solid ' + (state.sortDir === 1 ? 'fa-sort-up' : 'fa-sort-down');
                } else {
                    icon.className = 'fa-solid fa-sort';
                }
            });
        }

        function renderPager(totalPages) {
            if (!pagerEl) {
                return;
            }

            pagerEl.innerHTML = '';

            if (totalPages <= 1) {
                return;
            }

            function addItem(label, page, opts) {
                opts = opts || {};

                var li = document.createElement('li');
                li.className = 'page-item' + (opts.active ? ' active' : '') + (opts.disabled ? ' disabled' : '');

                var a = document.createElement('a');
                a.className = 'page-link';
                a.href = '#';
                a.textContent = label;

                if (opts.active) {
                    a.setAttribute('aria-current', 'page');
                }

                if (!opts.disabled && !opts.active) {
                    a.addEventListener('click', function (event) {
                        event.preventDefault();
                        state.page = page;
                        render();
                    });
                } else {
                    a.addEventListener('click', function (event) {
                        event.preventDefault();
                    });
                }

                li.appendChild(a);
                pagerEl.appendChild(li);
            }

            addItem('Anterior', state.page - 1, { disabled: state.page <= 1 });

            for (var page = 1; page <= totalPages; page++) {
                addItem(String(page), page, { active: page === state.page });
            }

            addItem('Próxima', state.page + 1, { disabled: state.page >= totalPages });
        }

        function render() {
            var filtered = rows.filter(matches);
            var sorted = sortRows(filtered);
            var total = sorted.length;
            var pageSize = state.pageSize;
            var totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;

            if (state.page > totalPages) {
                state.page = totalPages;
            }

            var start = pageSize > 0 ? (state.page - 1) * pageSize : 0;
            var end = pageSize > 0 ? start + pageSize : total;
            var visible = sorted.slice(start, end);

            rows.forEach(function (row) {
                row.hidden = true;
            });

            visible.forEach(function (row) {
                row.hidden = false;
                tbody.appendChild(row);
            });

            if (emptyRow) {
                emptyRow.hidden = total > 0;
                tbody.appendChild(emptyRow);
            }

            if (infoEl) {
                if (total === 0) {
                    infoEl.textContent = 'Nenhum resultado encontrado.';
                } else {
                    var shownFrom = start + 1;
                    var shownTo = Math.min(end, total);
                    var suffix = total === rows.length ? '' : ' (de ' + rows.length + ' no total)';
                    infoEl.textContent = 'Mostrando ' + shownFrom + '–' + shownTo + ' de ' + total + suffix + '.';
                }
            }

            updateSortIcons();
            renderPager(totalPages);
        }

        if (searchInput) {
            searchInput.addEventListener('input', function () {
                state.search = normalize(searchInput.value);
                state.page = 1;
                render();
            });
        }

        if (statusSelect) {
            statusSelect.addEventListener('change', function () {
                state.status = statusSelect.value;
                state.page = 1;
                render();
            });
        }

        if (pageSizeSelect) {
            pageSizeSelect.addEventListener('change', function () {
                state.pageSize = parseInt(pageSizeSelect.value, 10);
                state.page = 1;
                render();
            });
        }

        sortButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var key = button.getAttribute('data-sort');

                if (state.sortKey === key) {
                    state.sortDir *= -1;
                } else {
                    state.sortKey = key;
                    state.sortDir = 1;
                }

                state.page = 1;
                render();
            });
        });

        render();
    }

    document.querySelectorAll('[data-admin-table]').forEach(initAdminTable);
})();
