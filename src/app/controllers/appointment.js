/* eslint-disable camelcase */
import * as Yup from 'yup';
import { startOfHour, parseISO, isBefore, format, subHours } from 'date-fns';
import pt from 'date-fns/locale/pt';

import User from '../models/user';
import Appointment from '../models/appointment';
import File from '../models/file';

import Notification from '../schemas/notification';

/**
 * ESTOU UTILIZANDO O MAIL DIRETAMENTE NO CONTROLLER
 * A IMAGEM DO REDIS NÃO EXECUTOU COM SUCESSO NO WINDOWS
 */
import Mail from '../../lib/mail';
// import CancellationMail from '../jobs/cancallationmail';
// import Queue from '../../lib/queue';

class AppointmentController {
  async index(req, res) {
    const { page = 1 } = req.query;

    const appointments = await Appointment.finddAll({
      where: { user_id: req.userId, canceled_at: null },
      order: ['date'],
      attributes: ['id', 'date', 'past', 'cancelable'],
      limit: 20,
      offset: (page - 1) * 20,
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['id', 'name'],
          include: [
            {
              model: File,
              as: 'avatar',
              attributes: ['id', 'path', 'url'],
            },
          ],
        },
      ],
    });

    return res.json(appointments);
  }

  async store(req, res) {
    const schema = Yup.object().shape({
      provider_id: Yup.number().required(),
      date: Yup.date().required(),
    });

    if (!(await schema.isValid(req.body)))
      return res.status(400).json({ error: 'Validation fails.' });

    const { provider_id, date } = req.body;

    /**
     * Check if provider_id is a provider
     */
    const isProvider = await User.findOne({
      where: {
        id: provider_id,
        provider: true,
      },
    });

    if (!isProvider)
      return res
        .status(401)
        .json({ error: 'You can only create appointments with providers.' });

    const hourStart = startOfHour(parseISO(date));

    /**
     * Check for pst date
     */
    if (isBefore(hourStart, new Date()))
      return res.status(400).json({ error: 'Past date are not permitted.' });

    /**
     * Check date availability
     */
    const chechAvailability = await Appointment.findOne({
      where: {
        provider_id,
        canceled_at: null,
        date: hourStart,
      },
    });

    if (chechAvailability)
      return res
        .status(400)
        .json({ error: 'Appointment date is not available.' });

    const appointment = await Appointment.create({
      user_id: req.userId,
      provider_id,
      date: hourStart,
    });

    /**
     * Notify appointment provider
     */
    const user = await User.findByPk(req.userId);
    const formattedDate = format(
      hourStart,
      "'dia' dd 'de' MMMM', às' H:mm'h'",
      { locale: pt }
    );

    await Notification.create({
      content: `Novo agendamento de ${user.name} para ${formattedDate}`,
      user: provider_id,
    });

    return res.json(appointment);
  }

  async delete(req, res) {
    const appointment = await Appointment.findByPk(req.params.id, {
      include: [
        {
          model: User,
          as: 'provider',
          attributes: ['name', 'email'],
        },
        {
          model: User,
          as: 'user',
          attributes: ['name'],
        },
      ],
    });

    if (appointment.user_id !== req.userId)
      return res.status(401).json({
        error: "you don't have permission to cancel this appointment.",
      });

    const dateWithSub = subHours(appointment.date, 2);

    if (isBefore(dateWithSub, new Date()))
      return res.status(401).json({
        error: 'You can only cancel appointments 2 hours in advance.',
      });

    appointment.canceled_at = new Date();
    await appointment.save();

    await Mail.sendMail({
      to: `${appointment.provider.name} <${appointment.provider.email}>`,
      subject: 'Agendamento cancelado',
      template: 'cancellation',
      context: {
        provider: appointment.provider.name,
        user: appointment.user.name,
        date: format(appointment.date, "dd 'de' MMMM', às' H:mm'h'", {
          locale: pt,
        }),
      },
    });

    // await Queue.add(CancellationMail.key, {
    //   appointment,
    // });

    return res.json(appointment);
  }
}

export default new AppointmentController();