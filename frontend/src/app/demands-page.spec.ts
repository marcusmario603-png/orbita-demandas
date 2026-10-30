import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { DemandsPage } from './demands-page';
import { identityInterceptor } from './identity.interceptor';
import type { Demand, DemandPage } from './models';
import { SessionService } from './session.service';

const demand = (over: Partial<Demand> = {}): Demand => ({
  id: 1, title: 'Falha de sinal', queue: 'suporte', status: 1, workerId: null, workerName: null,
  outcome: null, failureReason: null, note: null, updatedAt: '2026-01-01T00:00:00.000Z', ...over,
});
const page = (items: Demand[], total = items.length): DemandPage => ({ items, total, page: 1, pageSize: 20 });

describe('DemandsPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<DemandsPage>;
  let el: HTMLElement;

  async function create(items: Demand[]) {
    fixture = TestBed.createComponent(DemandsPage);
    el = fixture.nativeElement;
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/demands').flush(page(items));
    await fixture.whenStable();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([identityInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionService).select(1, false);
  });

  afterEach(() => http.verify());

  it('lista as demandas e envia a identidade nos headers', async () => {
    fixture = TestBed.createComponent(DemandsPage);
    el = fixture.nativeElement;
    await fixture.whenStable();
    const req = http.expectOne((r) => r.url === '/api/demands');
    expect(req.request.headers.get('x-user-id')).toBe('1');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(page([demand({ id: 1 }), demand({ id: 2, title: 'Troca de plano' })]));
    await fixture.whenStable();

    expect(el.querySelectorAll('tbody tr.row')).toHaveLength(2);
    expect(el.textContent).toContain('1–2 de 2 demandas');
  });

  it('reserva com sucesso: atualiza a linha sem recarregar a lista', async () => {
    await create([demand({ id: 5 })]);

    el.querySelector<HTMLButtonElement>('td.act button')!.click();
    http.expectOne({ method: 'POST', url: '/api/demands/5/reserve' }).flush({
      demand: demand({ id: 5, status: 2, workerId: 1, workerName: 'Ana Souza' }),
      alreadyReserved: false,
    });
    await fixture.whenStable();

    expect(el.textContent).toContain('Demanda #5 reservada para você');
    expect(el.querySelector('.badge')!.textContent).toContain('Reservada');
    expect(el.querySelector('td.act button')!.textContent).toContain('Encerrar');
    // http.verify() no afterEach garante que não houve um novo GET /demands
  });

  it('409 na reserva: mostra quem ficou com a demanda e atualiza só a linha', async () => {
    await create([demand({ id: 5 }), demand({ id: 6 })]);

    el.querySelector<HTMLButtonElement>('tbody tr.row td.act button')!.click();
    http.expectOne({ method: 'POST', url: '/api/demands/5/reserve' }).flush(
      {
        error: 'already_reserved',
        message: 'Demanda já reservada por Bruno Lima',
        demand: demand({ id: 5, status: 2, workerId: 2, workerName: 'Bruno Lima' }),
      },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();

    const rows = el.querySelectorAll('tbody tr.row');
    expect(el.querySelector('.alert.error')!.textContent).toContain('Demanda já reservada por Bruno Lima');
    expect(rows[0]!.textContent).toContain('Bruno Lima');
    expect(rows[0]!.querySelector('.badge')!.textContent).toContain('Reservada');
    expect(rows[1]!.querySelector('.badge')!.textContent).toContain('Aberta'); // a outra linha não mudou
    expect(rows[0]!.querySelector('td.act button')).toBeNull(); // não é dono: sem "Encerrar"
  });

  it('o botão Reservar fica desabilitado enquanto a requisição está em andamento', async () => {
    await create([demand({ id: 5 })]);
    const button = el.querySelector<HTMLButtonElement>('td.act button')!;

    button.click();
    await fixture.whenStable();
    expect(button.disabled).toBe(true);

    http.expectOne('/api/demands/5/reserve').flush({ demand: demand({ id: 5, status: 2, workerId: 1 }), alreadyReserved: false });
  });

  it('formulário de encerramento: motivo é obrigatório só no insucesso e o botão acompanha a validade', async () => {
    await create([demand({ id: 9, status: 2, workerId: 1, workerName: 'Ana Souza' })]);

    el.querySelector<HTMLButtonElement>('td.act button')!.click();
    await fixture.whenStable();

    const submit = () => el.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!;
    const radio = (v: string) => el.querySelector<HTMLInputElement>(`input[type="radio"][value="${v}"]`)!;

    // sucesso: válido sem motivo
    expect(submit().disabled).toBe(false);
    expect(el.querySelector('#reason')).toBeNull();

    // insucesso: aparece o motivo e o botão desabilita
    radio('failure').click();
    await fixture.whenStable();
    expect(el.querySelector('#reason')).not.toBeNull();
    expect(submit().disabled).toBe(true);

    // escolhe o motivo: habilita
    const select = el.querySelector<HTMLSelectElement>('#reason')!;
    select.value = 'sem_cobertura';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(submit().disabled).toBe(false);

    // observação acima de 500 caracteres: desabilita de novo
    const note = el.querySelector<HTMLTextAreaElement>('#note')!;
    note.value = 'x'.repeat(501);
    note.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(submit().disabled).toBe(true);

    // volta para sucesso: o motivo some e (com a observação corrigida) volta a valer
    note.value = 'ok';
    note.dispatchEvent(new Event('input'));
    radio('success').click();
    await fixture.whenStable();
    expect(el.querySelector('#reason')).toBeNull();
    expect(submit().disabled).toBe(false);
  });

  it('encerra enviando o corpo certo (note aparada, sem motivo no sucesso)', async () => {
    await create([demand({ id: 9, status: 2, workerId: 1, workerName: 'Ana Souza' })]);
    el.querySelector<HTMLButtonElement>('td.act button')!.click();
    await fixture.whenStable();

    const note = el.querySelector<HTMLTextAreaElement>('#note')!;
    note.value = '  resolvido por telefone  ';
    note.dispatchEvent(new Event('input'));
    el.querySelector<HTMLFormElement>('dialog form')!.dispatchEvent(new Event('submit'));

    const req = http.expectOne({ method: 'POST', url: '/api/demands/9/finish' });
    expect(req.request.body).toEqual({ outcome: 'success', note: 'resolvido por telefone' });
    req.flush(demand({ id: 9, status: 3, workerId: 1, workerName: 'Ana Souza', outcome: 'success' }));
    await fixture.whenStable();

    expect(el.querySelector('dialog')).toBeNull();
    expect(el.textContent).toContain('Demanda #9 encerrada');
  });
});
